#!/usr/bin/env python3
"""Freebuff OpenAI API 反代代理 (Python 版)"""

import asyncio
import json
import os
import platform
import random
import signal
import string
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import quote

try:
    import aiohttp
    from aiohttp import web
except ImportError:
    print("请先安装 aiohttp: pip install aiohttp")
    sys.exit(1)

API_BASE = "www.codebuff.com"
LOCAL_PORT = 1145
POLL_INTERVAL_S = 5
TIMEOUT_S = 300

MODEL_TO_AGENT = {
    "minimax/minimax-m2.7": "base2-free",
    "z-ai/glm-5.1": "base2-free",
    "google/gemini-2.5-flash-lite": "file-picker",
    "google/gemini-3.1-flash-lite-preview": "file-picker-max",
    "google/gemini-3.1-pro-preview": "thinker-with-files-gemini",
}

default_model = "minimax/minimax-m2.7"
token = None
cached_run_id = None
cached_agent_id = None

C = {
    "R": "\033[0m", "B": "\033[1m", "G": "\033[32m",
    "Y": "\033[33m", "E": "\033[31m", "C": "\033[36m", "D": "\033[90m",
}


def log(msg, t="info"):
    c = {"success": C["G"], "error": C["E"], "warn": C["Y"]}.get(t, C["C"])
    icon = {"success": "✓", "error": "✗", "warn": "⚠"}.get(t, "ℹ")
    print(f"{c}{icon}{C['R']} {msg}")


def generate_fingerprint_id():
    chars = string.ascii_lowercase + string.digits
    return f"codebuff-cli-{''.join(random.choices(chars, k=26))}"


def get_config_paths():
    home = Path.home()
    if platform.system() == "Windows":
        config_dir = Path(os.environ.get("APPDATA", str(home))) / "manicode"
    else:
        config_dir = home / ".config" / "manicode"
    return config_dir, config_dir / "credentials.json"


def load_token():
    _, creds_path = get_config_paths()
    if creds_path.exists():
        try:
            creds = json.loads(creds_path.read_text(encoding="utf-8"))
            return creds.get("default", ).get("authToken")
        except Exception:
            pass
    return None


# ============ HTTP 请求 ============

async def api_request(session, hostname, path, body=None, auth_token=None, method="POST"):
    url = f"https://{hostname}{path}"
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "freebuff-proxy/1.0",
    }
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    kwargs = {"headers": headers, "timeout": aiohttp.ClientTimeout(total=30)}
    if body and method == "POST":
        kwargs["json"] = body

    async with session.request(method, url, **kwargs) as resp:
        try:
            data = await resp.json()
        except Exception:
            data = await resp.text()
        return {"status": resp.status, "data": data}


# ============ 登录流程 ============

async def do_login(session):
    log("需要登录 Freebuff...")
    fp_id = generate_fingerprint_id()
    log(f"指纹: {fp_id[:30]}...")

    res = await api_request(session, "freebuff.com", "/api/auth/cli/code", {"fingerprintId": fp_id})
    if res["status"] != 200 or "loginUrl" not in res["data"]:
        raise RuntimeError("获取登录 URL 失败")

    d = res["data"]
    login_url, fp_hash, expires = d["loginUrl"], d["fingerprintHash"], d["expiresAt"]

    print(f"\n{C['Y']}请在浏览器中打开:{C['R']}\n{C['C']}{login_url}{C['R']}\n")

    if platform.system() == "Darwin":
        subprocess.Popen(["open", login_url])
    elif platform.system() == "Windows":
        subprocess.Popen(["start", "", login_url], shell=True)

    input(f"{C['Y']}完成登录后按回车继续...{C['R']}")
    log("等待登录完成...")

    start = time.time()
    while time.time() - start < TIMEOUT_S:
        print(f"\r{C['D']}轮询中...{C['R']}", end="", flush=True)
        try:
            path = (
                f"/api/auth/cli/status?fingerprintId={quote(str(fp_id))}"
                f"&fingerprintHash={quote(str(fp_hash))}&expiresAt={quote(str(expires))}"
            )
            sr = await api_request(session, "freebuff.com", path, method="GET")
            if sr["status"] == 200 and "user" in sr["data"]:
                print()
                user = sr["data"]["user"]
                config_dir, creds_path = get_config_paths()
                config_dir.mkdir(parents=True, exist_ok=True)
                creds = {
                    "default": {
                        "id": user["id"], "name": user["name"], "email": user["email"],
                        "authToken": user.get("authToken") or user.get("auth_token"),
                        "credits": user.get("credits", 0),
                    }
                }
                creds_path.write_text(json.dumps(creds, indent=2), encoding="utf-8")
                log("登录成功！", "success")
                print(f"  用户: {user['name']} ({user['email']})")
                return creds["default"]["authToken"]
        except Exception as e:
            log(f"轮询出错: {e}", "error")
        await asyncio.sleep(POLL_INTERVAL_S)

    raise RuntimeError("登录超时")


# ============ Freebuff API ============

async def create_agent_run(session, auth_token, agent_id):
    t = time.time()
    res = await api_request(session, API_BASE, "/api/v1/agent-runs",
                            {"action": "START", "agentId": agent_id}, auth_token)
    ms = int((time.time() - t) * 1000)
    if res["status"] != 200 or "runId" not in res["data"]:
        raise RuntimeError(f"创建 Agent Run 失败: {json.dumps(res['data'])}")
    log(f"创建新 Agent Run: {res['data']['runId']} (耗时 {ms}ms)")
    return res["data"]["runId"]


async def get_or_create_agent_run(session, auth_token, agent_id):
    global cached_run_id, cached_agent_id
    if cached_agent_id != agent_id:
        cached_run_id = None
        cached_agent_id = agent_id
    if cached_run_id:
        return cached_run_id
    cached_run_id = await create_agent_run(session, auth_token, agent_id)
    return cached_run_id


async def finish_agent_run(session, auth_token, run_id):
    await api_request(session, API_BASE, "/api/v1/agent-runs", {
        "action": "FINISH", "runId": run_id, "status": "completed",
        "totalSteps": 1, "directCredits": 0, "totalCredits": 0,
    }, auth_token)


def make_freebuff_body(openai_body, run_id):
    body = dict(openai_body)
    body["codebuff_metadata"] = {
        "run_id": run_id,
        "client_id": f"freebuff-proxy-{''.join(random.choices(string.ascii_lowercase + string.digits, k=8))}",
        "cost_mode": "free",
    }
    return body


def build_openai_response(run_id, model, choice_data, usage_data=None):
    choice = choice_data or {}
    message = choice.get("message", {})
    resp = {
        "id": f"freebuff-{run_id}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": message.get("content", ""),
            },
            "finish_reason": choice.get("finish_reason", "stop"),
        }],
        "usage": {
            "prompt_tokens": (usage_data or {}).get("prompt_tokens", 0),
            "completion_tokens": (usage_data or {}).get("completion_tokens", 0),
            "total_tokens": (usage_data or {}).get("total_tokens", 0),
        },
    }
    if message.get("tool_calls"):
        resp["choices"][0]["message"]["tool_calls"] = message["tool_calls"]
    return resp


# ============ 流式转发 ============

async def stream_to_openai_format(session, freebuff_body, auth_token, response, model):
    url = f"https://{API_BASE}/api/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {auth_token}",
        "Accept": "text/event-stream",
        "User-Agent": "freebuff-proxy/1.0",
    }
    response_id = f"freebuff-{int(time.time() * 1000)}"
    finish_reason = "stop"

    timeout = aiohttp.ClientTimeout(total=120)
    async with session.post(url, json=freebuff_body, headers=headers, timeout=timeout) as resp:
        if resp.status != 200:
            err = await resp.text()
            raise RuntimeError(f"HTTP {resp.status}: {err}")

        buffer = ""
        async for chunk in resp.content.iter_any():
            buffer += chunk.decode("utf-8", errors="replace")
            lines = buffer.split("\n")
            buffer = lines.pop()

            for line in lines:
                trimmed = line.strip()
                if not trimmed or not trimmed.startswith("data: "):
                    continue
                json_str = trimmed[6:].strip()
                if json_str == "[DONE]":
                    await response.write(b"data: [DONE]\n\n")
                    continue
                try:
                    parsed = json.loads(json_str)
                    delta = (parsed.get("choices") or [{}])[0].get("delta", {})
                    cfr = (parsed.get("choices") or [{}])[0].get("finish_reason")
                    if cfr:
                        finish_reason = cfr

                    delta_obj = {}
                    if delta.get("content"):
                        delta_obj["content"] = delta["content"]
                    if delta.get("tool_calls"):
                        delta_obj["tool_calls"] = delta["tool_calls"]
                    if delta.get("role"):
                        delta_obj["role"] = delta["role"]

                    if delta_obj:
                        openai_chunk = {
                            "id": response_id,
                            "object": "chat.completion.chunk",
                            "created": int(time.time()),
                            "model": model,
                            "choices": [{"index": 0, "delta": delta_obj, "finish_reason": None}],
                        }
                        await response.write(f"data: {json.dumps(openai_chunk)}\n\n".encode())
                except Exception:
                    pass

        final_chunk = {
            "id": response_id,
            "object": "chat.completion.chunk",
            "created": int(time.time()),
            "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}],
        }
        await response.write(f"data: {json.dumps(final_chunk)}\n\n".encode())
        await response.write(b"data: [DONE]\n\n")
        await response.write_eof()


# ============ 路由处理 ============

async def handle_chat_completion(request):
    global cached_run_id
    start = time.time()
    session = request.app["client_session"]

    try:
        body = await request.json()
    except Exception:
        return web.json_response({"error": {"message": "Invalid JSON body"}}, status=400)

    model = body.get("model", default_model)
    agent_id = MODEL_TO_AGENT.get(model, "base2-free")
    log(f"收到请求: model={model}, messages={len(body.get('messages', []))}, stream={body.get('stream', False)}")

    try:
        run_id = await get_or_create_agent_run(session, token, agent_id)
    except Exception as e:
        return web.json_response({"error": {"message": str(e)}}, status=500)

    fb_body = make_freebuff_body(body, run_id)

    try:
        if body.get("stream"):
            response = web.StreamResponse(
                status=200,
                headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive"},
            )
            await response.prepare(request)
            await stream_to_openai_format(session, fb_body, token, response, model)
            log(f"请求完成，总耗时 {int((time.time() - start) * 1000)}ms", "success")
            return response
        else:
            res = await api_request(session, API_BASE, "/api/v1/chat/completions", fb_body, token)
            if res["status"] == 200:
                choice = (res["data"].get("choices") or [{}])[0]
                resp = build_openai_response(run_id, model, choice, res["data"].get("usage"))
                log(f"请求完成，总耗时 {int((time.time() - start) * 1000)}ms", "success")
                return web.json_response(resp)
            elif res["status"] in (400, 404):
                log("Agent Run 失效，重新创建...", "warn")
                cached_run_id = None
                run_id = await get_or_create_agent_run(session, token, agent_id)
                fb_body["codebuff_metadata"]["run_id"] = run_id
                retry = await api_request(session, API_BASE, "/api/v1/chat/completions", fb_body, token)
                if retry["status"] == 200:
                    choice = (retry["data"].get("choices") or [{}])[0]
                    resp = build_openai_response(run_id, model, choice, retry["data"].get("usage"))
                    log(f"重试成功，总耗时 {int((time.time() - start) * 1000)}ms", "success")
                    return web.json_response(resp)
                return web.json_response({"error": {"message": retry["data"]}}, status=retry["status"])
            else:
                return web.json_response({"error": {"message": res["data"]}}, status=res["status"])
    except Exception as e:
        log(f"请求失败: {e}", "error")
        return web.json_response({"error": {"message": str(e)}}, status=500)


async def handle_models(request):
    models = [{"id": m, "object": "model", "created": 1700000000, "owned_by": "freebuff"} for m in MODEL_TO_AGENT]
    return web.json_response({"object": "list", "data": models})


async def handle_reset_run(request):
    global cached_run_id
    cached_run_id = None
    log("Agent Run 缓存已清除")
    return web.json_response({"status": "cleared"})


async def handle_health(request):
    return web.json_response({
        "status": "ok", "model": default_model,
        "cachedRunId": cached_run_id, "cachedAgentId": cached_agent_id,
    })


# ============ 主入口 ============

async def main():
    global token, cached_run_id, cached_agent_id

    token = load_token()
    session = aiohttp.ClientSession()

    try:
        if not token:
            token = await do_login(session)
        else:
            log(f"已加载 Token: {token[:30]}...")

        log("预热：创建 Agent Run...")
        default_agent = MODEL_TO_AGENT.get(default_model, "base2-free")
        cached_run_id = await create_agent_run(session, token, default_agent)
        cached_agent_id = default_agent
        log("预热完成，Agent Run 已缓存", "success")

        app = web.Application()
        app["client_session"] = session
        app.router.add_post("/v1/chat/completions", handle_chat_completion)
        app.router.add_get("/v1/models", handle_models)
        app.router.add_post("/v1/reset-run", handle_reset_run)
        app.router.add_get("/health", handle_health)
        app.router.add_get("/", handle_health)

        runner = web.AppRunner(app)
        await runner.setup()
        site = web.TCPSite(runner, "0.0.0.0", LOCAL_PORT)
        await site.start()

        print(f"""
{C['B']}{C['C']}
╔══════════════════════════════════════════════════════════════╗
║               Freebuff OpenAI Proxy (Python)                 ║
║             本地端口: {LOCAL_PORT}                          ║
║              Agent Run 已缓存，零额外延迟                    ║
╚══════════════════════════════════════════════════════════════╝
{C['R']}""")
        log(f"代理地址: http://localhost:{LOCAL_PORT}/v1/chat/completions")
        log(f"模型列表: http://localhost:{LOCAL_PORT}/v1/models")
        log(f"重置缓存: http://localhost:{LOCAL_PORT}/v1/reset-run (POST)")
        log(f"健康检查: http://localhost:{LOCAL_PORT}/health")
        print(f"\n{C['Y']}可用模型:{C['R']}")
        for m, a in MODEL_TO_AGENT.items():
            print(f"  {C['C']}{m}{C['R']} → {a}")
        print(f"\n{C['G']}等待请求... (Ctrl+C 关闭){C['R']}\n")

        stop_event = asyncio.Event()
        loop = asyncio.get_event_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, stop_event.set)
            except NotImplementedError:
                pass  # Windows

        try:
            await stop_event.wait()
        except KeyboardInterrupt:
            pass

        if cached_run_id:
            log("关闭代理，结束 Agent Run...")
            try:
                await finish_agent_run(session, token, cached_run_id)
                log("Agent Run 已结束", "success")
            except Exception:
                pass

        await runner.cleanup()
    finally:
        await session.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass