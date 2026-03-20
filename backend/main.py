"""FastAPI 서버: 프론트엔드와 통신"""

import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from csv_parser import parse_csv, build_rungs
from code_generator import generate_code
from plc_engine import PLCEngine

import os

app = FastAPI()
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')


@app.get("/")
async def root():
    return FileResponse(os.path.join(FRONTEND_DIR, 'index.html'))


# 정적 파일 (css, js, images)
app.mount("/css", StaticFiles(directory=os.path.join(FRONTEND_DIR, 'css')), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(FRONTEND_DIR, 'js')), name="js")
app.mount("/images", StaticFiles(directory=os.path.join(FRONTEND_DIR, 'images')), name="images")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    engine = PLCEngine(scan_time_ms=100)

    async def scan_loop():
        """스캔 루프: engine.running이 True인 동안 반복"""
        while engine.running:
            engine.scan_once()
            state = engine.get_io_state()
            try:
                await websocket.send_json({
                    'type': 'io_state',
                    **state
                })
            except Exception:
                engine.stop()
                break
            await asyncio.sleep(engine.scan_time_ms / 1000)

    scan_task = None

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get('action')

            if action == 'run':
                csv_text = data.get('csv', '')
                generated = load_and_generate(csv_text)

                if generated:
                    engine.load_code(generated['code'])
                    engine.init_io(generated['variables'])
                    engine.start()

                    await websocket.send_json({
                        'type': 'code_generated',
                        'code': generated['code']
                    })

                    # 스캔 루프를 별도 태스크로 실행
                    scan_task = asyncio.create_task(scan_loop())
                else:
                    await websocket.send_json({
                        'type': 'error',
                        'message': 'CSV 파싱 또는 코드 생성 실패'
                    })

            elif action == 'stop':
                engine.stop()
                if scan_task:
                    await scan_task
                    scan_task = None
                await websocket.send_json({
                    'type': 'stopped'
                })

            elif action == 'set_input':
                var = data.get('var', '')
                value = data.get('value', False)
                engine.set_input(var, value)

    except WebSocketDisconnect:
        engine.stop()
    except Exception as e:
        print(f"WebSocket error: {e}")
        engine.stop()


def load_and_generate(csv_text: str) -> dict | None:
    """CSV → 파싱 → 렁 구조 → Python 코드 생성"""
    try:
        parsed = parse_csv(csv_text)
        rungs = build_rungs(parsed)
        code = generate_code(rungs)

        variables = set()
        for rung in rungs:
            for step in rung['main']['steps']:
                if step and step.get('var'):
                    variables.add(step['var'])
            for branch in rung.get('branches', []):
                for step in branch['steps']:
                    if step and step.get('var'):
                        variables.add(step['var'])

        return {
            'code': code,
            'variables': list(variables)
        }
    except Exception as e:
        print(f"Error: {e}")
        return None


def run_server():
    """백엔드 서버만 실행 (브라우저에서 접속)"""
    import uvicorn
    uvicorn.run(app, host='0.0.0.0', port=8000)


def run_app():
    """PyWebView 창 + 백엔드 서버 실행"""
    import threading
    import webview

    # 백엔드 서버를 별도 스레드에서 실행
    server_thread = threading.Thread(target=run_server, daemon=True)
    server_thread.start()

    # 서버 시작 대기
    import time
    import urllib.request
    for _ in range(30):
        try:
            urllib.request.urlopen('http://localhost:8000/')
            break
        except Exception:
            time.sleep(0.5)

    # PyWebView 창 열기
    webview.create_window(
        'PLC Simulator',
        'http://localhost:8000/',
        width=1400,
        height=800,
    )
    webview.start()


if __name__ == '__main__':
    import sys
    if '--server' in sys.argv:
        run_server()
    else:
        run_app()
