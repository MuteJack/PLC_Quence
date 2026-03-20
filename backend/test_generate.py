"""코드 생성 테스트"""

from csv_parser import parse_csv, build_rungs
from code_generator import generate_code

# 테스트 CSV: 자기유지회로
test_csv = """[meta]
key,value
version,1.0
stepCount,12
outputCol,11

[ladder]
rung,type,comment,s0,v0,s1,v1,s2,v2,s3,v3,s4,v4,s5,v5,s6,v6,s7,v7,s8,v8,s9,v9,s10,v10,s11
0,main,모터 자기유지,line,d,contact_a:X0,,contact_b:X1,,line,,line,,line,,line,,line,,line,,line,,line,,output:Y0
0,branch,,line,u,contact_a:Y0,,,,,,,,,,,,,,,,,,,,

[variables]
name,comment
X0,시작버튼
X1,정지버튼
Y0,모터
Y1,램프
"""

print("=== CSV 파싱 ===")
parsed = parse_csv(test_csv)
print(f"Meta: {parsed['meta']}")
print(f"Ladder rows: {len(parsed['ladder_rows'])}")
print(f"Variables: {parsed['variables']}")

print("\n=== 렁 구조 ===")
rungs = build_rungs(parsed)
for rung in rungs:
    print(f"Rung {rung['id']}: {rung['comment']}")
    print(f"  Main steps: {[s['var'] if s else '-' for s in rung['main']['steps']]}")
    print(f"  Main vlines: {rung['main']['vlines']}")
    for i, branch in enumerate(rung['branches']):
        print(f"  Branch {i}: {[s['var'] if s else '-' for s in branch['steps']]}")
        print(f"  Branch vlines: {branch['vlines']}")

print("\n=== 생성된 코드 ===")
code = generate_code(rungs)
print(code)

print("\n=== 실행 테스트 ===")
io = {'X0': False, 'X1': False, 'Y0': False}
timers = {}

exec(code)

print(f"초기 상태: {io}")

io['X0'] = True
scan_cycle(io, timers)
print(f"X0=ON (시작): {io}")

io['X0'] = False
scan_cycle(io, timers)
print(f"X0=OFF (자기유지): {io}")

io['X1'] = True
scan_cycle(io, timers)
print(f"X1=ON (정지): {io}")

io['X1'] = False
scan_cycle(io, timers)
print(f"X1=OFF (정지유지): {io}")
