"""코드 생성기: 래더 렁 구조 → Python 실행 코드 변환"""


CONTACT_A_FAMILIES = ('contact_a',)
CONTACT_B_FAMILIES = ('contact_b',)
OUTPUT_FAMILIES = ('output',)


def generate_code(rungs: list) -> str:
    """렁 리스트를 Python 스캔 함수 코드로 변환

    Args:
        rungs: build_rungs()의 반환값

    Returns:
        실행 가능한 Python 코드 문자열
    """
    lines = []
    lines.append('"""자동 생성된 PLC 래더 로직"""')
    lines.append('')
    lines.append('')
    lines.append('def scan_cycle(io, timers):')
    lines.append('    """1 스캔 사이클 실행')
    lines.append('    ')
    lines.append('    Args:')
    lines.append('        io: dict - I/O 상태 {변수명: bool}')
    lines.append('        timers: dict - 타이머 상태 {변수명: Timer}')
    lines.append('    """')

    if not rungs:
        lines.append('    pass')
        return '\n'.join(lines)

    for rung in rungs:
        lines.append('')
        comment = rung.get('comment', '')
        lines.append(f'    # === Rung {rung["id"]}: {comment} ===')

        rung_lines = _generate_rung(rung)
        for line in rung_lines:
            lines.append(f'    {line}')

    lines.append('')
    return '\n'.join(lines)


def _generate_rung(rung: dict) -> list:
    """렁 하나를 Python 코드로 변환"""
    lines = []
    main = rung['main']
    branches = rung.get('branches', [])
    rung_id = rung['id']

    main_steps = main['steps']
    main_vlines = {v['col']: v['dir'] for v in main['vlines']}

    # output 찾기 (마지막 step)
    output_step = None
    output_idx = None
    for i in range(len(main_steps) - 1, -1, -1):
        step = main_steps[i]
        if step and step['family'] in OUTPUT_FAMILIES:
            output_step = step
            output_idx = i
            break

    if not output_step:
        lines.append('pass  # 출력 없음')
        return lines

    # branch가 없는 경우: 단순 직렬
    if not branches:
        contacts = _collect_contacts(main_steps, 0, output_idx)
        if contacts:
            expr = _build_and_expr(contacts)
            lines.append(f'rung{rung_id} = {expr}')
        else:
            lines.append(f'rung{rung_id} = True')

        _append_output(lines, output_step, rung_id)
        return lines

    # branch가 있는 경우: 분기 구간 파악
    # v-down 위치 수집 (main)
    vdown_cols = sorted(col for col, d in main_vlines.items() if d == 'd')

    if not vdown_cols:
        # vertical line 정보가 없으면 단순 직렬 처리
        contacts = _collect_contacts(main_steps, 0, output_idx)
        if contacts:
            expr = _build_and_expr(contacts)
            lines.append(f'rung{rung_id} = {expr}')
        else:
            lines.append(f'rung{rung_id} = True')

        _append_output(lines, output_step, rung_id)
        return lines

    # branch row의 v-up 위치 수집
    for branch in branches:
        branch_vlines = {v['col']: v['dir'] for v in branch['vlines']}
        vup_cols = sorted(col for col, d in branch_vlines.items() if d == 'u')

        # 분기 구간: v-down은 셀 오른쪽에 있으므로 해당 셀까지가 분기 전
        # v-down col → 분기 전은 0 ~ col+1 (col 포함)
        # v-up col → 분기 후는 col+1 ~
        branch_start = min(vdown_cols) if vdown_cols else 0
        branch_end = max(vup_cols) if vup_cols else output_idx

        # === 분기 전 (공통 AND): 0 ~ branch_start+1 (branch_start 셀 포함) ===
        pre_contacts = _collect_contacts(main_steps, 0, branch_start + 1)

        # === 분기 구간 (OR) ===
        # 분기 시작: v-down 셀 다음
        range_start = branch_start + 1

        # 분기 끝: branch row에서 마지막 컴포넌트 위치 + 1
        last_branch_comp = range_start
        for idx in range(len(branch['steps']) - 1, -1, -1):
            if branch['steps'][idx] is not None:
                last_branch_comp = idx + 1
                break
        range_end = max(branch_end + 1, last_branch_comp)

        # main path
        main_path_contacts = _collect_contacts(main_steps, range_start, range_end)

        # branch path
        branch_path_contacts = _collect_contacts(branch['steps'], range_start, range_end)

        # === 분기 후 (공통 AND): branch_end+1 ~ output_idx ===
        post_contacts = _collect_contacts(main_steps, range_end, output_idx)

        # 코드 생성
        parts = []

        if pre_contacts:
            pre_expr = _build_and_expr(pre_contacts)
            parts.append(pre_expr)

        # OR 부분: 접점이 없는 경로는 제외 (도선만 있는 경우)
        or_parts = []
        if main_path_contacts:
            or_parts.append(_build_and_expr(main_path_contacts))

        if branch_path_contacts:
            or_parts.append(_build_and_expr(branch_path_contacts))

        # 양쪽 모두 접점이 없으면 True
        if not or_parts:
            or_parts.append('True')

        if len(or_parts) > 1:
            or_expr = f'({" or ".join(or_parts)})'
        else:
            or_expr = or_parts[0]
        parts.append(or_expr)

        if post_contacts:
            post_expr = _build_and_expr(post_contacts)
            parts.append(post_expr)

        full_expr = ' and '.join(parts) if parts else 'True'
        lines.append(f'rung{rung_id} = {full_expr}')

    _append_output(lines, output_step, rung_id)
    return lines


def _collect_contacts(steps: list, start: int, end: int) -> list:
    """steps[start:end] 에서 접점만 수집"""
    contacts = []
    for i in range(start, min(end, len(steps))):
        step = steps[i]
        if step and step['family'] in CONTACT_A_FAMILIES + CONTACT_B_FAMILIES:
            contacts.append(step)
    return contacts


def _build_and_expr(contacts: list) -> str:
    """접점 리스트를 AND 표현식으로"""
    parts = []
    for c in contacts:
        var = c['var']
        if c['family'] in CONTACT_B_FAMILIES:
            parts.append(f"not io['{var}']")
        else:
            parts.append(f"io['{var}']")

    if len(parts) == 1:
        return parts[0]
    return ' and '.join(parts)


def _append_output(lines: list, output_step: dict, rung_id: int):
    """출력 코드 추가"""
    var = output_step['var']
    if not var:
        return

    # 타이머 출력
    prefix = var[0] if var else ''
    if prefix == 'T':
        lines.append(f"if rung{rung_id}:")
        lines.append(f"    timers['{var}'].run()")
        lines.append(f"else:")
        lines.append(f"    timers['{var}'].reset()")
        lines.append(f"io['{var}'] = timers['{var}'].done")
    else:
        lines.append(f"io['{var}'] = rung{rung_id}")
