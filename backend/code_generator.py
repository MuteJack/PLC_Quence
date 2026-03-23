"""코드 생성기: 래더 렁 구조 → Python 실행 코드 변환"""


CONTACT_A_FAMILIES = ('contact_a',)
CONTACT_B_FAMILIES = ('contact_b',)
OUTPUT_FAMILIES = ('output',)
RST_FAMILIES = ('rst',)


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
    lines.append('def scan_cycle(io, timers, counters):')
    lines.append('    """1 스캔 사이클 실행')
    lines.append('    ')
    lines.append('    Args:')
    lines.append('        io: dict - I/O 상태 {변수명: bool}')
    lines.append('        timers: dict - 타이머 상태 {변수명: Timer}')
    lines.append('        counters: dict - 카운터 상태 {변수명: Counter}')
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

    # output과 RST 찾기
    output_step = None
    output_idx = None
    rst_steps = []
    for i in range(len(main_steps) - 1, -1, -1):
        step = main_steps[i]
        if step and step['family'] in OUTPUT_FAMILIES and output_step is None:
            output_step = step
            output_idx = i
    for i, step in enumerate(main_steps):
        if step and step['family'] in RST_FAMILIES:
            rst_steps.append((i, step))

    if not output_step and not rst_steps:
        lines.append('pass  # 출력 없음')
        return lines

    # output_idx가 없으면 RST만 있는 렁 → RST 위치 기준
    effective_output_idx = output_idx if output_idx is not None else len(main_steps)

    # branch가 없는 경우: 단순 직렬
    if not branches:
        contacts = _collect_contacts(main_steps, 0, effective_output_idx)
        if contacts:
            expr = _build_and_expr(contacts)
            lines.append(f'rung{rung_id} = {expr}')
        else:
            lines.append(f'rung{rung_id} = True')

        if output_step:
            _append_output(lines, output_step, rung_id)
        for _, rst in rst_steps:
            _append_rst(lines, rst, rung_id)
        return lines

    # branch가 있는 경우: 분기 구간 파악
    # v-down 위치 수집 (main)
    vdown_cols = sorted(col for col, d in main_vlines.items() if d == 'd')

    if not vdown_cols:
        # vertical line 정보가 없으면 단순 직렬 처리
        contacts = _collect_contacts(main_steps, 0, effective_output_idx)
        if contacts:
            expr = _build_and_expr(contacts)
            lines.append(f'rung{rung_id} = {expr}')
        else:
            lines.append(f'rung{rung_id} = True')

        if output_step:
            _append_output(lines, output_step, rung_id)
        for _, rst in rst_steps:
            _append_rst(lines, rst, rung_id)
        return lines

    # branch row에 자체 output이 있는지 확인
    branch_has_output = False
    for branch in branches:
        for step in branch['steps']:
            if step and step['family'] in OUTPUT_FAMILIES + RST_FAMILIES:
                branch_has_output = True
                break

    if branch_has_output:
        # === 각 경로에 자체 output이 있는 경우 ===
        branch_start = min(vdown_cols)

        # 공통 입력 (분기 전)
        pre_contacts = _collect_contacts(main_steps, 0, branch_start + 1)
        if pre_contacts:
            pre_expr = _build_and_expr(pre_contacts)
            lines.append(f'rung{rung_id}_pre = {pre_expr}')
        else:
            lines.append(f'rung{rung_id}_pre = True')

        # 모든 경로 (main + branches) 수집
        all_paths = []

        # main 경로
        main_contacts = _collect_contacts(main_steps, branch_start + 1, effective_output_idx)
        main_output = output_step
        main_rsts = rst_steps
        all_paths.append({
            'name': f'rung{rung_id}_main',
            'contacts': main_contacts,
            'output': main_output,
            'rsts': main_rsts,
            'vlines': main_vlines,
        })

        # branch 경로
        for bi, branch in enumerate(branches):
            branch_contacts = _collect_contacts(branch['steps'], 0, len(branch['steps']))
            branch_output = None
            branch_rsts = []
            branch_vl = {v['col']: v['dir'] for v in branch['vlines']}
            for step in branch['steps']:
                if step and step['family'] in OUTPUT_FAMILIES:
                    branch_output = step
                if step and step['family'] in RST_FAMILIES:
                    branch_rsts.append(step)
            all_paths.append({
                'name': f'rung{rung_id}_b{bi}',
                'contacts': branch_contacts,
                'output': branch_output,
                'rsts': branch_rsts,
                'vlines': branch_vl,
            })

        # branch 간 OR 그룹 감지: branch 간 vertical line(d/u 쌍)이 있으면 OR
        or_groups = []  # [{paths: [idx, ...], expr_name: str}]
        grouped = set()

        for i in range(1, len(all_paths)):
            for j in range(i + 1, len(all_paths)):
                vl_i = all_paths[i].get('vlines', {})
                vl_j = all_paths[j].get('vlines', {})
                # i에 d, j에 u (또는 반대)가 같은 col에 있으면 OR 그룹
                for col in vl_i:
                    if col in vl_j:
                        if (vl_i[col] == 'd' and vl_j[col] == 'u') or \
                           (vl_i[col] == 'u' and vl_j[col] == 'd'):
                            # OR 그룹 찾기 또는 생성
                            found = False
                            for g in or_groups:
                                if i in g['paths'] or j in g['paths']:
                                    g['paths'].add(i)
                                    g['paths'].add(j)
                                    found = True
                                    break
                            if not found:
                                or_groups.append({'paths': {i, j}})
                            grouped.add(i)
                            grouped.add(j)

        # 각 경로 / OR 그룹에 대해 코드 생성
        for i, path in enumerate(all_paths):
            if i in grouped:
                continue  # OR 그룹에서 처리

            if path['contacts']:
                expr = f'rung{rung_id}_pre and {_build_and_expr(path["contacts"])}'
            else:
                expr = f'rung{rung_id}_pre'
            lines.append(f'{path["name"]} = {expr}')

            if path['output']:
                _append_output_with_expr(lines, path['output'], path['name'])
            for rst in path.get('rsts', []):
                if isinstance(rst, tuple):
                    rst = rst[1]
                _append_rst_with_expr(lines, rst, path['name'])

        # OR 그룹 처리
        for gi, group in enumerate(or_groups):
            path_indices = sorted(group['paths'])
            or_parts = []
            for idx in path_indices:
                path = all_paths[idx]
                if path['contacts']:
                    or_parts.append(_build_and_expr(path['contacts']))
                else:
                    or_parts.append('True')

            if len(or_parts) > 1:
                or_expr = f'({" or ".join(or_parts)})'
            else:
                or_expr = or_parts[0]
            group_name = f'rung{rung_id}_or{gi}'
            lines.append(f'{group_name} = rung{rung_id}_pre and {or_expr}')

            # 그룹 내 모든 output에 같은 결과 적용
            for idx in path_indices:
                path = all_paths[idx]
                if path['output']:
                    _append_output_with_expr(lines, path['output'], group_name)
                for rst in path.get('rsts', []):
                    if isinstance(rst, tuple):
                        rst = rst[1]
                    _append_rst_with_expr(lines, rst, group_name)

    else:
        # === branch에 output이 없는 경우: 기존 OR 합류 방식 ===
        for branch in branches:
            branch_vlines = {v['col']: v['dir'] for v in branch['vlines']}
            vup_cols = sorted(col for col, d in branch_vlines.items() if d == 'u')

            branch_start = min(vdown_cols) if vdown_cols else 0
            branch_end = max(vup_cols) if vup_cols else effective_output_idx

            pre_contacts = _collect_contacts(main_steps, 0, branch_start + 1)
            range_start = branch_start + 1

            last_branch_comp = range_start
            for idx in range(len(branch['steps']) - 1, -1, -1):
                if branch['steps'][idx] is not None:
                    last_branch_comp = idx + 1
                    break
            range_end = max(branch_end + 1, last_branch_comp)

            main_path_contacts = _collect_contacts(main_steps, range_start, range_end)
            branch_path_contacts = _collect_contacts(branch['steps'], range_start, range_end)
            post_contacts = _collect_contacts(main_steps, range_end, effective_output_idx)

            parts = []
            if pre_contacts:
                parts.append(_build_and_expr(pre_contacts))

            or_parts = []
            if main_path_contacts:
                or_parts.append(_build_and_expr(main_path_contacts))
            if branch_path_contacts:
                or_parts.append(_build_and_expr(branch_path_contacts))
            if not or_parts:
                or_parts.append('True')

            if len(or_parts) > 1:
                or_expr = f'({" or ".join(or_parts)})'
            else:
                or_expr = or_parts[0]
            parts.append(or_expr)

            if post_contacts:
                parts.append(_build_and_expr(post_contacts))

            full_expr = ' and '.join(parts) if parts else 'True'
            lines.append(f'rung{rung_id} = {full_expr}')

        if output_step:
            _append_output(lines, output_step, rung_id)
        for _, rst in rst_steps:
            _append_rst(lines, rst, rung_id)

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
    _append_output_with_expr(lines, output_step, f'rung{rung_id}')


def _append_rst(lines: list, rst_step: dict, rung_id: int):
    """RST 코드 추가"""
    _append_rst_with_expr(lines, rst_step, f'rung{rung_id}')


def _append_output_with_expr(lines: list, output_step: dict, expr: str):
    """출력 코드 추가 (임의 표현식 사용)"""
    var = output_step['var']
    if not var:
        return

    prefix = var[0] if var else ''
    if prefix == 'T':
        lines.append(f"if {expr}:")
        lines.append(f"    timers['{var}'].run()")
        lines.append(f"else:")
        lines.append(f"    timers['{var}'].reset()")
        lines.append(f"io['{var}'] = timers['{var}'].done")
    elif prefix == 'C':
        lines.append(f"counters['{var}'].update({expr})")
        lines.append(f"io['{var}'] = counters['{var}'].done")
    else:
        lines.append(f"io['{var}'] = {expr}")


def _append_rst_with_expr(lines: list, rst_step: dict, expr: str):
    """RST 코드 추가 (임의 표현식 사용)"""
    var = rst_step['var']
    if not var:
        return

    prefix = var[0] if var else ''
    if prefix == 'T':
        lines.append(f"if {expr}:")
        lines.append(f"    timers['{var}'].reset()")
        lines.append(f"    io['{var}'] = False")
    elif prefix == 'C':
        lines.append(f"if {expr}:")
        lines.append(f"    counters['{var}'].reset()")
        lines.append(f"    io['{var}'] = False")
