const Ladder = {
    rungCount: 1,
    stepCount: 12,
    outputCol: 11,
    selectedRow: null,
    selectedRows: [],       // 다중 rung/branch 선택
    selectedComponent: null,
    selectedStep: null,
    selectedSteps: [],      // 다중 step 선택
    selectedVertical: null,
    clipboard: null,        // 복사 데이터 {type: 'steps'|'rows', data: [...]}
    running: false,
    ws: null,
    lastIOState: {},

    // 컴포넌트 계열 분류
    COMP_FAMILY: {
        'PB_A': 'contact_a',
        'Contact_Memory_A': 'contact_a',
        'Contact_Timer_A': 'contact_a',
        'Contact_Y_A': 'contact_a',
        'PB_B': 'contact_b',
        'Contact_Memory_B': 'contact_b',
        'Contact_Timer_B': 'contact_b',
        'Contact_Y_B': 'contact_b',
        'Output_Y': 'output',
        'Output_Timer': 'output',
        'Function_Memory': 'output',
        'Output_Basic': 'output',
    },

    // 계열 + 접두사 → 컴포넌트 타입
    PREFIX_TO_COMP: {
        'contact_a': { 'X': 'PB_A', 'M': 'Contact_Memory_A', 'Y': 'Contact_Y_A', 'T': 'Contact_Timer_A' },
        'contact_b': { 'X': 'PB_B', 'M': 'Contact_Memory_B', 'Y': 'Contact_Y_B', 'T': 'Contact_Timer_B' },
        'output': { 'Y': 'Output_Y', 'M': 'Function_Memory', 'T': 'Output_Timer' },
    },

    // 계열별 허용 접두사
    FAMILY_PREFIXES: {
        'contact_a': ['X', 'M', 'Y', 'T'],
        'contact_b': ['X', 'M', 'Y', 'T'],
        'output': ['Y', 'M', 'T'],
    },

    // 할당된 변수명 추적 (변수명 → 사용 횟수)
    usedVariables: {},
    // output 계열 전용 추적 (코일 중복 방지용)
    usedOutputVariables: {},
    // 변수별 코멘트 (변수명 → 설명)
    variableComments: {},

    STEP_CELL_HTML: '<td><div class="step-cell"><div class="step-name"></div><div class="step-symbol"><div class="step-symbol-back"></div><div class="step-symbol-fore"><div class="step-symbol-left"></div><div class="step-symbol-center"></div><div class="step-symbol-right"></div></div></div><div class="step-comment"></div></div></td>',

    // branch row의 빈 셀 (Line_Normal 배경 없음)
    BRANCH_CELL_HTML: '<td><div class="step-cell branch-cell"><div class="step-name"></div><div class="step-symbol"><div class="step-symbol-back"></div><div class="step-symbol-fore"><div class="step-symbol-left"></div><div class="step-symbol-center"></div><div class="step-symbol-right"></div></div></div><div class="step-comment"></div></div></td>',

    init() {
        document.querySelector('.btn-add-rung').addEventListener('click', () => this.addRung());

        // 더블클릭 → Comment 편집 (Run 중 비활성)
        document.querySelector('#ladder-table tbody').addEventListener('dblclick', (e) => {
            if (this.running) return;
            // Rung Comment 열
            const td = e.target.closest('td');
            if (td) {
                const tr = td.closest('.rung-row');
                if (tr && !tr.classList.contains('rung-add')) {
                    const cells = Array.from(tr.children);
                    if (cells.indexOf(td) === 0) {
                        this.editComment(td);
                        return;
                    }
                }
            }

            // Step Name (컴포넌트가 있는 셀 또는 빈 셀)
            const stepName = e.target.closest('.step-name');
            if (stepName) {
                const td = stepName.closest('td');
                const tr = td.closest('tr');
                if (!tr || tr.classList.contains('rung-add')) return;

                const symbol = stepName.closest('.step-cell').querySelector('.step-symbol');
                const comp = symbol ? symbol.dataset.component : null;

                // Line은 제외
                if (comp === 'Line') return;

                // outputCol은 기존 방식
                const cells = Array.from(tr.children);
                const stepTds = cells.slice(2, 2 + this.stepCount);
                const idx = stepTds.indexOf(td);
                if (idx === this.outputCol) {
                    if (comp) this.editStepName(stepName, comp);
                    return;
                }

                // 빈 셀 또는 컴포넌트 셀 → 변수명 입력 (빈 셀은 contact_a 기본)
                this.editStepNameWithCreate(stepName, td, tr);
                return;
            }

            // Step Comment (변수명이 있는 셀만)
            const stepComment = e.target.closest('.step-comment');
            if (stepComment) {
                const stepCell = stepComment.closest('.step-cell');
                const nameDiv = stepCell.querySelector('.step-name');
                const varName = nameDiv ? nameDiv.textContent.trim() : '';
                if (varName) {
                    this.editVariableComment(stepComment, varName);
                }
            }
        });

        document.querySelectorAll('.comp-item').forEach(item => {
            item.addEventListener('click', () => this.selectComponent(item));
        });

        // 인접 셀 하이라이트
        document.querySelector('#ladder-table tbody').addEventListener('mouseover', (e) => {
            if (!this.selectedComponent) return;
            this.clearAdjacentHighlight();

            const right = e.target.closest('.step-symbol-right');
            if (right) {
                const td = right.closest('td');
                const nextTd = td.nextElementSibling;
                if (nextTd) {
                    const adjLeft = nextTd.querySelector('.step-symbol-left');
                    if (adjLeft) adjLeft.classList.add('adjacent-highlight');
                }
                return;
            }

            const left = e.target.closest('.step-symbol-left');
            if (left) {
                const td = left.closest('td');
                const prevTd = td.previousElementSibling;
                if (prevTd) {
                    const adjRight = prevTd.querySelector('.step-symbol-right');
                    if (adjRight) adjRight.classList.add('adjacent-highlight');
                }
            }
        });

        document.querySelector('#ladder-table tbody').addEventListener('mouseout', (e) => {
            const zone = e.target.closest('.step-symbol-left, .step-symbol-right');
            if (zone) this.clearAdjacentHighlight();
        });

        // 클릭 이벤트
        document.querySelector('#ladder-table tbody').addEventListener('click', (e) => {
            // Run 상태: X 접점 클릭만 허용
            if (this.running) {
                const symbolCenter = e.target.closest('.step-symbol-center');
                if (symbolCenter) {
                    const symbolDiv = symbolCenter.closest('.step-symbol');
                    const comp = symbolDiv ? symbolDiv.dataset.component : '';
                    if (comp && comp.startsWith('PB_')) {
                        const nameDiv = symbolDiv.closest('.step-cell').querySelector('.step-name');
                        const varName = nameDiv ? nameDiv.textContent.trim() : '';
                        if (varName && varName.startsWith('X')) {
                            this.toggleInput(varName);
                        }
                    }
                }
                return;
            }

            if (this.selectedComponent) {
                const type = this.selectedComponent.dataset.type;

                // Vertical: 좌/우 영역만 클릭 가능
                if (type === 'Vertical') {
                    const symbolLeft = e.target.closest('.step-symbol-left');
                    const symbolRight = e.target.closest('.step-symbol-right');
                    if (symbolLeft || symbolRight) {
                        this.placeVertical(symbolLeft || symbolRight);
                    }
                    return;
                }

                // 가운데 클릭 → 배치
                const symbolCenter = e.target.closest('.step-symbol-center');
                if (symbolCenter) {
                    this.placeComponent(symbolCenter);
                    return;
                }

                // 왼쪽/오른쪽 클릭
                const symbolLeft = e.target.closest('.step-symbol-left');
                const symbolRight = e.target.closest('.step-symbol-right');
                if (symbolLeft || symbolRight) {
                    const zone = symbolLeft || symbolRight;
                    const td = zone.closest('td');
                    const symbol = td.querySelector('.step-symbol');
                    const hasComponent = symbol && symbol.dataset.component && symbol.dataset.component !== 'Line';

                    if (hasComponent) {
                        // 컴포넌트가 있는 셀 → shift insert
                        const direction = symbolLeft ? 'left' : 'right';
                        this.insertComponent(zone, direction);
                    } else {
                        // 빈 셀 → center처럼 자동 배치
                        const center = zone.closest('.step-symbol').querySelector('.step-symbol-center');
                        if (center) this.placeComponent(center);
                    }
                    return;
                }
            }

            // 컴포넌트 미선택: center 클릭 → step 선택 (빈 셀도 가능)
            const symbolCenter = e.target.closest('.step-symbol-center');
            if (symbolCenter) {
                const symbolDiv = symbolCenter.closest('.step-symbol');
                if (symbolDiv.dataset.component !== 'Output_Basic') {
                    this.selectStep(symbolDiv, e.ctrlKey || e.metaKey);
                    return;
                }
            }

            // 컴포넌트 미선택: 좌/우 영역 클릭 → vertical line 선택
            const sideZone = e.target.closest('.step-symbol-left, .step-symbol-right');
            if (sideZone) {
                const stepCell = sideZone.closest('.step-cell');
                const side = sideZone.classList.contains('step-symbol-right') ? 'right' : 'left';
                const vLine = stepCell.querySelector(`.vertical-line.vertical-line-${side}`);
                if (vLine) {
                    this.selectVerticalLine(vLine);
                    return;
                }
            }

            // #열 또는 Comment열 클릭 → rung/branch 선택
            const td = e.target.closest('td');
            if (!td) return;
            const tr = td.closest('.rung-row');
            if (!tr || tr.classList.contains('rung-add')) return;

            const cells = Array.from(tr.children);
            if (cells.indexOf(td) === 1) {
                this.selectRung(tr, e.ctrlKey || e.metaKey);
            }
        });

        // 초기 rung에 기본 output 설정
        const initialRows = document.querySelectorAll('#ladder-table tbody .rung-row:not(.rung-add):not(.rung-branch)');
        initialRows.forEach(row => this.setDefaultOutput(row));

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Delete') {
                if (this.selectedVertical) {
                    this.deleteVerticalLine();
                } else if (this.selectedSteps.length > 0) {
                    // 다중 선택 시 모두 삭제
                    this.selectedSteps.forEach(s => {
                        this.selectedStep = s;
                        this.deleteStep();
                    });
                    this.selectedSteps = [];
                } else if (this.selectedStep) {
                    this.deleteStep();
                } else if (this.selectedRows.length > 0) {
                    this.selectedRows.slice().reverse().forEach(r => {
                        this.selectedRow = r;
                        this.deleteRung();
                    });
                    this.selectedRows = [];
                } else if (this.selectedRow) {
                    this.deleteRung();
                }
            }
            if (e.key === 'Escape') {
                this.clearComponentSelection();
                this.clearStepSelection();
                this.clearVerticalSelection();
                this.clearMultiSelection();
            }
            // Ctrl+C: 복사
            if (e.key === 'c' && (e.ctrlKey || e.metaKey)) {
                this.copySelection();
            }
            // Ctrl+V: 붙여넣기
            if (e.key === 'v' && (e.ctrlKey || e.metaKey)) {
                this.pasteSelection();
            }
        });

        // 패널 리사이즈
        this.initResize('resize-right', 'panel-monitor', 'right');
        this.initColResize();
    },

    // === Component 선택 ===

    selectComponent(item) {
        if (this.selectedComponent) {
            this.selectedComponent.classList.remove('comp-selected');
        }
        if (this.selectedComponent === item) {
            this.selectedComponent = null;
            document.body.classList.remove('placing-mode');
            return;
        }
        item.classList.add('comp-selected');
        this.selectedComponent = item;
        document.body.classList.add('placing-mode');
    },

    clearAdjacentHighlight() {
        document.querySelectorAll('.adjacent-highlight').forEach(el => {
            el.classList.remove('adjacent-highlight');
        });
    },

    clearComponentSelection() {
        if (this.selectedComponent) {
            this.selectedComponent.classList.remove('comp-selected');
            this.selectedComponent = null;
            document.body.classList.remove('placing-mode');
        }
    },

    // === Step 선택/삭제 ===

    selectStep(symbolDiv, ctrlKey) {
        if (ctrlKey) {
            // Ctrl+Click: 다중 선택 토글
            if (symbolDiv.classList.contains('step-selected')) {
                symbolDiv.classList.remove('step-selected');
                this.selectedSteps = this.selectedSteps.filter(s => s !== symbolDiv);
                if (this.selectedStep === symbolDiv) {
                    this.selectedStep = this.selectedSteps.length > 0 ? this.selectedSteps[this.selectedSteps.length - 1] : null;
                }
            } else {
                symbolDiv.classList.add('step-selected');
                this.selectedSteps.push(symbolDiv);
                this.selectedStep = symbolDiv;
            }
        } else {
            // 일반 클릭: 단일 선택
            this.clearMultiSelection();
            if (this.selectedStep) {
                this.selectedStep.classList.remove('step-selected');
            }
            if (this.selectedStep === symbolDiv) {
                this.selectedStep = null;
                return;
            }
            if (this.selectedRow) {
                this.selectedRow.classList.remove('rung-selected');
                this.selectedRow = null;
            }
            symbolDiv.classList.add('step-selected');
            this.selectedStep = symbolDiv;
            this.selectedSteps = [symbolDiv];
        }
    },

    clearStepSelection() {
        if (this.selectedStep) {
            this.selectedStep.classList.remove('step-selected');
            this.selectedStep = null;
        }
        this.selectedSteps.forEach(s => s.classList.remove('step-selected'));
        this.selectedSteps = [];
    },

    selectVerticalLine(vLine) {
        if (this.selectedVertical) {
            this.selectedVertical.classList.remove('vertical-selected');
        }
        if (this.selectedVertical === vLine) {
            this.selectedVertical = null;
            return;
        }
        // 他の選択解除
        this.clearStepSelection();
        if (this.selectedRow) {
            this.selectedRow.classList.remove('rung-selected');
            this.selectedRow = null;
        }
        vLine.classList.add('vertical-selected');
        this.selectedVertical = vLine;
    },

    clearVerticalSelection() {
        if (this.selectedVertical) {
            this.selectedVertical.classList.remove('vertical-selected');
            this.selectedVertical = null;
        }
    },

    clearMultiSelection() {
        this.selectedSteps.forEach(s => s.classList.remove('step-selected'));
        this.selectedSteps = [];
        this.selectedRows.forEach(r => r.classList.remove('rung-selected'));
        this.selectedRows = [];
    },

    // === 셀 데이터 추출/복원 ===

    _extractCellData(td) {
        const symbolDiv = td.querySelector('.step-symbol');
        const nameDiv = td.querySelector('.step-name');
        const commentDiv = td.querySelector('.step-comment');
        const stepCell = td.querySelector('.step-cell');
        const comp = symbolDiv ? symbolDiv.dataset.component : null;
        const varName = nameDiv ? nameDiv.textContent.trim() : '';
        const comment = commentDiv ? commentDiv.textContent.trim() : '';
        // vertical lines
        const vLines = [];
        if (stepCell) {
            stepCell.querySelectorAll('.vertical-line').forEach(v => {
                vLines.push({
                    side: v.classList.contains('vertical-line-right') ? 'right' : 'left',
                    dir: v.classList.contains('v-down') ? 'down' : 'up'
                });
            });
        }
        return { comp, varName, comment, vLines };
    },

    _extractRowData(tr) {
        const cells = Array.from(tr.children);
        const commentTd = cells[0];
        const rungComment = commentTd ? commentTd.textContent.trim() : '';
        const isBranch = tr.classList.contains('rung-branch');
        const stepTds = cells.slice(2, 2 + this.stepCount);
        const stepsData = stepTds.map(td => this._extractCellData(td));
        // branch rows
        const branchRows = [];
        if (!isBranch) {
            let next = tr.nextElementSibling;
            while (next && next.classList.contains('rung-branch')) {
                branchRows.push(this._extractRowData(next));
                next = next.nextElementSibling;
            }
        }
        return { rungComment, isBranch, stepsData, branchRows };
    },

    // === 복사 ===

    copySelection() {
        if (this.running) return;

        // rung/branch 선택 복사
        const rows = this.selectedRows.length > 0 ? this.selectedRows : (this.selectedRow ? [this.selectedRow] : []);
        if (rows.length > 0) {
            const data = rows.map(tr => this._extractRowData(tr));
            this.clipboard = { type: 'rows', data };
            return;
        }

        // step 선택 복사
        const steps = this.selectedSteps.length > 0 ? this.selectedSteps : (this.selectedStep ? [this.selectedStep] : []);
        if (steps.length > 0) {
            const data = steps.map(s => {
                const td = s.closest('td');
                return this._extractCellData(td);
            });
            this.clipboard = { type: 'steps', data };
            return;
        }
    },

    // === 붙여넣기 ===

    pasteSelection() {
        if (this.running || !this.clipboard) return;

        if (this.clipboard.type === 'rows') {
            this._pasteRows();
        } else if (this.clipboard.type === 'steps') {
            this._pasteSteps();
        }
    },

    _pasteRows() {
        const tbody = document.querySelector('#ladder-table tbody');
        const addRow = tbody.querySelector('.rung-add');
        // 선택된 행 아래, 또는 마지막에 붙여넣기
        let insertAfter = this.selectedRow || addRow.previousElementSibling;

        this.clipboard.data.forEach(rowData => {
            if (rowData.isBranch) return; // branch는 메인과 함께 처리

            // 새 rung 추가
            const newTr = this._createRungRow();
            // insertAfter의 branch들 뒤에 삽입
            let afterEl = insertAfter;
            while (afterEl.nextElementSibling && afterEl.nextElementSibling.classList.contains('rung-branch')) {
                afterEl = afterEl.nextElementSibling;
            }
            afterEl.after(newTr);

            // 셀 데이터 복원
            const cells = Array.from(newTr.children);
            const commentTd = cells[0];
            commentTd.textContent = rowData.rungComment;
            const stepTds = cells.slice(2, 2 + this.stepCount);

            rowData.stepsData.forEach((cellData, i) => {
                if (i >= stepTds.length) return;
                this._restoreCellData(stepTds[i], cellData, true); // true = duplicate (새 변수명으로)
            });

            this.setDefaultOutput(newTr);

            // branch rows 복원
            rowData.branchRows.forEach(brData => {
                const brTr = this._createBranchRow();
                newTr.after(brTr);
                const brCells = Array.from(brTr.children);
                const brStepTds = brCells.slice(2, 2 + this.stepCount);
                brData.stepsData.forEach((cellData, i) => {
                    if (i >= brStepTds.length) return;
                    this._restoreCellData(brStepTds[i], cellData, true);
                });
            });

            insertAfter = newTr;
            this.rungCount++;
        });

        this.renumberRungs();
        this.updateVariableMonitor();
    },

    _pasteSteps() {
        // 선택된 step 위치에 붙여넣기, 또는 선택된 step 오른쪽에
        const targetStep = this.selectedStep;
        if (!targetStep) return;

        const targetTd = targetStep.closest('td');
        const targetTr = targetTd.closest('tr');
        const cells = Array.from(targetTr.children);
        const stepTds = cells.slice(2, 2 + this.stepCount);
        let startIdx = stepTds.indexOf(targetTd);

        this.clipboard.data.forEach((cellData, i) => {
            const idx = startIdx + i;
            if (idx >= this.outputCol) return; // output 열은 건너뜀
            const td = stepTds[idx];
            if (!td) return;
            this._restoreCellData(td, cellData, true);
        });

        this.updateVariableMonitor();
    },

    _restoreCellData(td, cellData, duplicate) {
        const symbolDiv = td.querySelector('.step-symbol');
        const nameDiv = td.querySelector('.step-name');
        const back = td.querySelector('.step-symbol-back');

        if (!cellData.comp || cellData.comp === 'Output_Basic') return;

        // 컴포넌트 배치
        const imgName = cellData.comp + '_Normal';
        back.innerHTML = `<img src="images/Components/${imgName}.svg">`;
        symbolDiv.dataset.component = cellData.comp;

        // 변수명 (duplicate 시 충돌 방지)
        if (cellData.varName && !duplicate) {
            nameDiv.textContent = cellData.varName;
        } else if (cellData.varName && duplicate) {
            // 접점은 같은 변수명 허용, 출력은 새 변수명 필요
            const family = this.COMP_FAMILY[cellData.comp] || '';
            if (family.startsWith('contact') || family === 'contact_a' || family === 'contact_b') {
                nameDiv.textContent = cellData.varName;
            } else {
                // 출력 계열: 중복이면 변수명 비우기
                const existing = document.querySelectorAll('.step-name');
                const used = Array.from(existing).map(n => n.textContent.trim()).filter(Boolean);
                if (used.includes(cellData.varName)) {
                    nameDiv.textContent = '';
                } else {
                    nameDiv.textContent = cellData.varName;
                }
            }
        }

        // 변수 등록
        if (nameDiv.textContent.trim()) {
            this.registerVariable(nameDiv.textContent.trim(), cellData.comp);
        }

        // 코멘트는 변수 기반으로 자동 반영됨
    },

    _createRungRow() {
        const tr = document.createElement('tr');
        tr.classList.add('rung-row');
        // Comment 열
        const commentTd = document.createElement('td');
        commentTd.classList.add('rung-comment');
        tr.appendChild(commentTd);
        // # 열
        const numTd = document.createElement('td');
        numTd.classList.add('rung-num');
        tr.appendChild(numTd);
        // Step 열
        for (let i = 0; i < this.stepCount; i++) {
            const td = document.createElement('td');
            td.innerHTML = this._createStepCellHTML(i);
            tr.appendChild(td);
        }
        return tr;
    },

    _createBranchRow() {
        const tr = document.createElement('tr');
        tr.classList.add('rung-row', 'rung-branch');
        // Comment 열
        const commentTd = document.createElement('td');
        commentTd.classList.add('rung-comment');
        tr.appendChild(commentTd);
        // # 열
        const numTd = document.createElement('td');
        numTd.classList.add('rung-num');
        tr.appendChild(numTd);
        // Step 열 (branch는 Line 배경 없음)
        for (let i = 0; i < this.stepCount; i++) {
            const td = document.createElement('td');
            td.innerHTML = this._createStepCellHTML(i, true);
            tr.appendChild(td);
        }
        return tr;
    },

    _createStepCellHTML(colIdx, isBranch) {
        const isOutputCol = colIdx === this.outputCol;
        const rightZone = isOutputCol ? '' : `<div class="step-symbol-right" data-side="right"></div>`;
        const bgClass = isBranch ? 'branch-cell' : '';
        return `<div class="step-cell ${bgClass}">
            <div class="step-name"></div>
            <div class="step-symbol" style="position:relative;">
                <div class="step-symbol-back"></div>
                <div class="step-symbol-fore">
                    <div class="step-symbol-left" data-side="left"></div>
                    <div class="step-symbol-center"></div>
                    ${rightZone}
                </div>
            </div>
            <div class="step-comment"></div>
        </div>`;
    },

    deleteVerticalLine() {
        const vLine = this.selectedVertical;
        const stepCell = vLine.closest('.step-cell');
        const td = stepCell.closest('td');
        const tr = td.closest('tr');

        // この vertical line の方向とside
        const isDown = vLine.classList.contains('v-down');
        const isRight = vLine.classList.contains('vertical-line-right');
        const side = isRight ? 'right' : 'left';

        // 対になる行を見つける
        let pairedRow;
        if (isDown) {
            // メイン行 → branch行のv-upを探す
            pairedRow = tr.nextElementSibling;
        } else {
            // branch行 → メイン行のv-downを探す
            pairedRow = tr.previousElementSibling;
        }

        // 同じ列位置のペアを削除
        if (pairedRow) {
            const cells = Array.from(tr.children);
            const tdIdx = cells.indexOf(td);
            const pairedTd = pairedRow.children[tdIdx];
            if (pairedTd) {
                const pairedCell = pairedTd.querySelector('.step-cell');
                if (pairedCell) {
                    const pairedDir = isDown ? 'v-up' : 'v-down';
                    const pairedLine = pairedCell.querySelector(`.vertical-line.vertical-line-${side}.${pairedDir}`);
                    if (pairedLine) pairedLine.remove();
                }
            }
        }

        // 自分を削除
        vLine.remove();
        this.selectedVertical = null;

        // branch row를 특정하여 비어있으면 삭제
        const branchRow = isDown ? pairedRow : tr;
        if (branchRow && branchRow.classList.contains('rung-branch')) {
            const remainingLines = branchRow.querySelectorAll('.vertical-line');
            const remainingComponents = branchRow.querySelectorAll('.step-symbol[data-component]');
            if (remainingLines.length === 0 && remainingComponents.length === 0) {
                branchRow.remove();
            }
        }
    },

    deleteStep() {
        const symbolDiv = this.selectedStep;
        const td = symbolDiv.closest('td');
        const tr = td.closest('tr');
        const isBranch = tr.classList.contains('rung-branch');
        const cells = Array.from(tr.children);
        const stepTds = cells.slice(2, 2 + this.stepCount);
        const deletedIdx = stepTds.indexOf(td);

        // outputCol의 output 삭제 → Output_Basic으로 복원 (comment 유지, 변수명 해제)
        if (!isBranch && deletedIdx === this.outputCol) {
            const nameDiv = td.querySelector('.step-name');
            if (nameDiv && nameDiv.textContent.trim()) {
                this.unregisterVariable(nameDiv.textContent.trim());
                nameDiv.textContent = '';
            }
            const back = symbolDiv.querySelector('.step-symbol-back');
            back.innerHTML = '<img src="images/Components/Output_Basic_Normal.svg">';
            symbolDiv.dataset.component = 'Output_Basic';
            this.selectedStep = null;
            symbolDiv.classList.remove('step-selected');
            return;
        }

        // 삭제 전에 vertical line 위치 저장
        const vLineData = this.getVerticalLineIndices(tr);

        // 삭제 위치에서 오른쪽 경계(vertical line) 찾기
        const vlineSelector = isBranch ? '.vertical-line.v-up' : '.vertical-line';

        // 삭제 위치에서 같은 구간의 끝 찾기
        // vertical line은 셀 오른쪽에 붙음 → 그 셀까지가 구간 끝
        let rangeEnd = deletedIdx;
        for (let i = deletedIdx; i < this.outputCol; i++) {
            rangeEnd = i;
            const cell = stepTds[i].querySelector('.step-cell');
            if (cell && cell.querySelector(vlineSelector)) break;
        }

        // shift 대상 수집 (deletedIdx ~ rangeEnd)
        const shiftable = [];
        for (let i = deletedIdx; i <= rangeEnd; i++) {
            shiftable.push(i);
        }

        // shiftable 내에서 왼쪽으로 shift
        for (let j = 0; j < shiftable.length - 1; j++) {
            this.copyCellContent(stepTds[shiftable[j + 1]], stepTds[shiftable[j]]);
        }

        // 마지막 shiftable 셀 비우기
        if (shiftable.length > 0) {
            const lastIdx = shiftable[shiftable.length - 1];
            const lastSymbol = stepTds[lastIdx].querySelector('.step-symbol');
            const lastBack = stepTds[lastIdx].querySelector('.step-symbol-back');
            const lastComment = stepTds[lastIdx].querySelector('.step-comment');
            const lastNameDiv = stepTds[lastIdx].querySelector('.step-name');
            // 변수명 해제
            if (lastNameDiv && lastNameDiv.textContent.trim()) {
                this.unregisterVariable(lastNameDiv.textContent.trim());
            }
            lastBack.innerHTML = '';
            delete lastSymbol.dataset.component;
            if (lastComment) lastComment.textContent = '';
            if (lastNameDiv) lastNameDiv.textContent = '';
        }

        // vertical line 재배치
        this.restoreVerticalLines(tr, vLineData);

        this.selectedStep = null;
        symbolDiv.classList.remove('step-selected');

        // branch row에서 삭제 시, 비어있으면 행 삭제
        if (tr && tr.classList.contains('rung-branch')) {
            const remainingLines = tr.querySelectorAll('.vertical-line');
            const remainingComponents = tr.querySelectorAll('.step-symbol[data-component]');
            if (remainingLines.length === 0 && remainingComponents.length === 0) {
                tr.remove();
            }
        }

        // 메인 행에서 삭제 시, 완전히 비면 행 삭제 (최소 1개 유지)
        if (tr && !tr.classList.contains('rung-branch') && this.isRungEmpty(tr)) {
            const tbody = document.querySelector('#ladder-table tbody');
            const mainRows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
            if (mainRows.length > 1) {
                // branch row도 함께 삭제
                let next = tr.nextElementSibling;
                while (next && next.classList.contains('rung-branch')) {
                    const toRemove = next;
                    next = next.nextElementSibling;
                    toRemove.remove();
                }
                tr.remove();
                this.renumberRungs();
            }
        }
    },

    // === 타입 판별 ===

    // Line 컴포넌트는 빈 셀로 취급
    isCellAvailable(td) {
        const symbol = td.querySelector('.step-symbol');
        if (!symbol) return false;
        if (!symbol.dataset.component) return true;
        if (symbol.dataset.component === 'Line') return true;
        return false;
    },

    isOutputType(type) {
        return type.startsWith('Output_') || type.startsWith('Function_');
    },

    isInputType(type) {
        return type.startsWith('PB_') || type.startsWith('Contact_');
    },

    // === 컴포넌트 배치 ===

    placeComponent(symbolCenter) {
        const type = this.selectedComponent.dataset.type;
        const imgSrc = `images/Components/${type}_Normal.svg`;
        const symbolDiv = symbolCenter.closest('.step-symbol');
        const td = symbolDiv.closest('td');
        const tr = td.closest('tr');

        // Line을 컴포넌트가 있는 셀에 배치 → delete와 동일 동작
        if (type === 'Line' && symbolDiv.dataset.component && symbolDiv.dataset.component !== 'Line') {
            this.selectedStep = symbolDiv;
            symbolDiv.classList.add('step-selected');
            this.deleteStep();
            return;
        }

        // 메인 행에서 빈 셀에 Line 배치는 무시 (기본 배경이 이미 Line)
        if (type === 'Line' && !tr.classList.contains('rung-branch')) return;

        // output → 항상 outputCol에 배치
        if (this.isOutputType(type)) {
            const cells = Array.from(tr.children);
            const outputTd = cells[2 + this.outputCol];
            if (!outputTd) return;
            const outSymbol = outputTd.querySelector('.step-symbol');
            const outBack = outputTd.querySelector('.step-symbol-back');
            outBack.innerHTML = `<img src="${imgSrc}">`;
            outSymbol.dataset.component = type;
            return;
        }

        // 빈 셀 또는 Line 셀 클릭 → 자동 배치
        if (!symbolDiv.dataset.component || symbolDiv.dataset.component === 'Line') {
            const clickedIdx = Array.from(tr.children).indexOf(td) - 2;
            const targetTd = this.findAutoPlaceTd(tr, type, clickedIdx);
            if (!targetTd) return;
            const targetSymbol = targetTd.querySelector('.step-symbol');
            const targetBack = targetTd.querySelector('.step-symbol-back');
            targetBack.innerHTML = `<img src="${imgSrc}">`;
            targetSymbol.dataset.component = type;
            return;
        }

        // 이미 컴포넌트가 있는 셀 → 교체
        const backDiv = symbolDiv.querySelector('.step-symbol-back');
        backDiv.innerHTML = `<img src="${imgSrc}">`;
        symbolDiv.dataset.component = type;
    },

    // 자동 배치: 클릭 위치 기준으로 가장 가까운 vertical line 범위 내에서 배치
    findAutoPlaceTd(tr, type, clickedIdx) {
        const cells = Array.from(tr.children);
        const stepTds = cells.slice(2, 2 + this.stepCount);
        const isBranch = tr.classList.contains('rung-branch');

        // branch에서는 v-up만 범위 경계, 메인에서는 모든 vertical-line이 경계
        const boundarySelector = isBranch ? '.vertical-line.v-up' : '.vertical-line';

        // 클릭 위치 왼쪽에서 가장 가까운 경계 찾기 (클릭 셀 자체는 제외)
        let rangeStart = 0;
        for (let i = clickedIdx - 1; i >= 0; i--) {
            const cell = stepTds[i].querySelector('.step-cell');
            if (cell && cell.querySelector(boundarySelector)) {
                rangeStart = i + 1;
                break;
            }
        }

        // branch: 가장 왼쪽 v-up보다 왼쪽은 배치 불가
        if (isBranch) {
            let firstVLineIdx = -1;
            for (let i = 0; i < stepTds.length; i++) {
                const cell = stepTds[i].querySelector('.step-cell');
                if (cell && cell.querySelector('.vertical-line.v-up')) {
                    firstVLineIdx = i;
                    break;
                }
            }
            if (firstVLineIdx >= 0 && rangeStart <= firstVLineIdx) {
                rangeStart = firstVLineIdx + 1;
            }
            if (clickedIdx <= firstVLineIdx) return null;
        }

        // 클릭 위치 오른쪽에서 가장 가까운 경계 찾기 (outputCol 제외, 클릭 셀 자체는 제외)
        let rangeEnd = this.outputCol - 1;
        for (let i = clickedIdx + 1; i < this.outputCol; i++) {
            const cell = stepTds[i].querySelector('.step-cell');
            if (cell && cell.querySelector(boundarySelector)) {
                rangeEnd = i;
                break;
            }
        }

        // Line 배치 시에는 진짜 빈 셀만, 그 외에는 Line도 빈 셀 취급
        const checkAvailable = (td) => {
            if (type === 'Line') {
                const symbol = td.querySelector('.step-symbol');
                return symbol && !symbol.dataset.component;
            }
            return this.isCellAvailable(td);
        };

        if (this.isOutputType(type)) {
            for (let i = rangeEnd; i >= rangeStart; i--) {
                if (isBranch && i === 0) continue;
                if (checkAvailable(stepTds[i])) {
                    return stepTds[i];
                }
            }
        } else {
            for (let i = rangeStart; i <= rangeEnd; i++) {
                if (isBranch && i === 0) continue;
                if (checkAvailable(stepTds[i])) {
                    return stepTds[i];
                }
            }
        }
        return null;
    },

    isRungFull(tr) {
        const cells = Array.from(tr.children);
        const stepTds = cells.slice(2, 2 + this.stepCount);
        return stepTds.every(td => td.querySelector('.step-symbol[data-component]'));
    },

    // === Insert ===

    createNewStepTd(type, isBranch) {
        const imgSrc = `images/Components/${type}_Normal.svg`;
        const template = document.createElement('template');
        template.innerHTML = isBranch ? this.BRANCH_CELL_HTML : this.STEP_CELL_HTML;
        const td = template.content.firstElementChild;
        td.querySelector('.step-symbol-back').innerHTML = `<img src="${imgSrc}">`;
        td.querySelector('.step-symbol').dataset.component = type;
        return td;
    },

    // vertical line 위치(열 인덱스) 수집
    getVerticalLineIndices(tr) {
        const cells = Array.from(tr.children).slice(2, 2 + this.stepCount);
        const indices = [];
        cells.forEach((td, i) => {
            const cell = td.querySelector('.step-cell');
            if (cell) {
                const lines = cell.querySelectorAll('.vertical-line');
                lines.forEach(line => {
                    indices.push({
                        colIdx: i,
                        classes: Array.from(line.classList)
                    });
                });
            }
        });
        return indices;
    },

    // vertical line 재배치
    restoreVerticalLines(tr, lineData) {
        // 기존 vertical line 전부 제거
        tr.querySelectorAll('.vertical-line').forEach(el => el.remove());
        // 저장된 위치에 재배치
        const cells = Array.from(tr.children).slice(2, 2 + this.stepCount);
        lineData.forEach(data => {
            const td = cells[data.colIdx];
            if (!td) return;
            const cell = td.querySelector('.step-cell');
            if (!cell) return;
            const line = document.createElement('div');
            line.className = data.classes.join(' ');
            cell.appendChild(line);
        });
    },

    // insert: 현재 셀 ~ 가장 가까운 오른쪽 빈 셀 사이를 밀기
    insertComponent(clickedZone, direction) {
        const currentTd = clickedZone.closest('td');
        const tr = currentTd.closest('tr');
        const isBranch = tr.classList.contains('rung-branch');
        const type = this.selectedComponent.dataset.type;

        // 메인 행에서 Line insert는 무시
        if (type === 'Line' && !isBranch) return;

        // branch: 가장 왼쪽 v-up보다 왼쪽이면 insert 불가
        if (isBranch) {
            const cells = Array.from(tr.children);
            const stepTds = cells.slice(2, 2 + this.stepCount);
            const currentIdx = stepTds.indexOf(currentTd);
            let firstVLineIdx = -1;
            for (let i = 0; i < stepTds.length; i++) {
                const cell = stepTds[i].querySelector('.step-cell');
                if (cell && cell.querySelector('.vertical-line.v-up')) {
                    firstVLineIdx = i;
                    break;
                }
            }
            if (firstVLineIdx >= 0 && currentIdx <= firstVLineIdx) return;
        }

        const cells = Array.from(tr.children);
        const stepTds = cells.slice(2, 2 + this.stepCount);
        const currentIdx = stepTds.indexOf(currentTd);
        const insertIdx = direction === 'left' ? currentIdx : currentIdx + 1;

        // output은 insert 불가
        if (this.isOutputType(type)) return;

        // insertIdx부터 같은 구간 내에서 빈 셀 찾기
        const isBranchRow = tr.classList.contains('rung-branch');
        const vlineSel = isBranchRow ? '.vertical-line.v-up' : '.vertical-line';
        let emptyIdx = -1;
        for (let i = insertIdx; i < this.outputCol; i++) {
            // vertical line이 있는 셀 = 구간 끝, 빈 셀이면 여기까지 포함
            const cell = stepTds[i].querySelector('.step-cell');
            const hasVLine = cell && cell.querySelector(vlineSel);
            if (this.isCellAvailable(stepTds[i])) {
                emptyIdx = i;
                break;
            }
            if (hasVLine) break;
        }

        if (emptyIdx === -1) return;

        // vertical line 위치 저장
        const vLineData = this.getVerticalLineIndices(tr);

        // 빈 셀 ← 방향으로 내용 shift (emptyIdx부터 insertIdx까지)
        for (let i = emptyIdx; i > insertIdx; i--) {
            this.copyCellContent(stepTds[i - 1], stepTds[i]);
        }

        // insertIdx 셀을 새 컴포넌트로 채우기
        this.setCellContent(stepTds[insertIdx], type);

        // vertical line 원래 위치에 재배치
        this.restoreVerticalLines(tr, vLineData);
    },

    // 셀 내용 복사 (src → dst)
    copyCellContent(srcTd, dstTd) {
        const srcSymbol = srcTd.querySelector('.step-symbol');
        const dstSymbol = dstTd.querySelector('.step-symbol');
        const srcBack = srcTd.querySelector('.step-symbol-back');
        const dstBack = dstTd.querySelector('.step-symbol-back');
        const srcComment = srcTd.querySelector('.step-comment');
        const dstComment = dstTd.querySelector('.step-comment');
        const srcName = srcTd.querySelector('.step-name');
        const dstName = dstTd.querySelector('.step-name');

        dstBack.innerHTML = srcBack.innerHTML;
        if (srcSymbol.dataset.component) {
            dstSymbol.dataset.component = srcSymbol.dataset.component;
        } else {
            delete dstSymbol.dataset.component;
        }

        if (srcComment && dstComment) {
            dstComment.textContent = srcComment.textContent;
        }
        if (srcName && dstName) {
            dstName.textContent = srcName.textContent;
        }
    },

    // 셀에 새 컴포넌트 설정
    setCellContent(td, type) {
        const imgSrc = `images/Components/${type}_Normal.svg`;
        const symbol = td.querySelector('.step-symbol');
        const back = td.querySelector('.step-symbol-back');
        back.innerHTML = `<img src="${imgSrc}">`;
        symbol.dataset.component = type;
    },

    insertBranchComponent(clickedZone, direction) {
        this.insertComponent(clickedZone, direction);
    },


    // === Vertical (Branch) ===

    placeVertical(clickedZone) {
        const isLeft = clickedZone.classList.contains('step-symbol-left');
        const td = clickedZone.closest('td');
        const tr = td.closest('tr');
        const cells = Array.from(tr.children);
        const stepIdx = cells.indexOf(td) - 2;

        if (stepIdx < 0 || stepIdx >= this.stepCount) return;

        // 세로선은 한쪽 셀에만 배치 (이중선 방지)
        // 왼쪽 클릭 → 왼쪽 셀의 오른쪽 끝에 배치
        // 오른쪽 클릭 → 현재 셀의 오른쪽 끝에 배치
        let anchorTd;
        if (isLeft) {
            anchorTd = cells[stepIdx + 2 - 1]; // 왼쪽 셀
            if (!anchorTd || !anchorTd.querySelector('.step-cell')) return;
        } else {
            anchorTd = td; // 현재 셀
        }

        // 메인 행: 아래로 반줄
        const mainCell = anchorTd.querySelector('.step-cell');
        this.addVerticalLine(mainCell, 'right', 'v-down');

        // branch row 생성 또는 기존 사용
        let branchRow = tr.nextElementSibling;
        if (!branchRow || !branchRow.classList.contains('rung-branch')) {
            branchRow = this.createBranchRow(tr);
        }

        // branch 행: 위로 반줄 (같은 열 위치)
        const branchCells = Array.from(branchRow.children);
        const branchAnchorIdx = cells.indexOf(anchorTd);
        const branchTd = branchCells[branchAnchorIdx];
        if (branchTd) {
            const branchCell = branchTd.querySelector('.step-cell');
            if (branchCell) {
                this.addVerticalLine(branchCell, 'right', 'v-up');
            }
        }
    },

    addVerticalLine(stepCell, side, direction) {
        // 같은 위치에 이미 세로선이 있으면 추가하지 않음
        const existing = stepCell.querySelector(`.vertical-line.vertical-line-${side}.${direction}`);
        if (existing) return;

        const line = document.createElement('div');
        line.className = `vertical-line vertical-line-${side} ${direction}`;
        stepCell.appendChild(line);
    },

    createBranchRow(parentRow) {
        const tr = document.createElement('tr');
        tr.className = 'rung-row rung-branch';
        tr.dataset.rung = parentRow.dataset.rung || parentRow.children[1].textContent;

        // Comment, #: 빈 셀 (렁 번호 없음)
        let cells = '<td></td><td></td>';
        for (let i = 0; i < this.stepCount; i++) {
            cells += this.BRANCH_CELL_HTML;
        }
        cells += '<td></td>';
        tr.innerHTML = cells;

        // parentRow 바로 아래에 삽입
        parentRow.parentNode.insertBefore(tr, parentRow.nextSibling);
        return tr;
    },

    // === 변수명 편집 ===

    getNextVariableName(prefix) {
        for (let i = 0; i < 1000; i++) {
            const name = `${prefix}${i}`;
            if (!this.usedVariables[name] || this.usedVariables[name] === 0) {
                return name;
            }
        }
        return `${prefix}0`;
    },

    registerVariable(name, family) {
        if (!name) return;
        this.usedVariables[name] = (this.usedVariables[name] || 0) + 1;
        if (family === 'output') {
            this.usedOutputVariables[name] = (this.usedOutputVariables[name] || 0) + 1;
        }
        this.updateVariableMonitor();
    },

    unregisterVariable(name, family) {
        if (!name) return;
        if (this.usedVariables[name]) {
            this.usedVariables[name]--;
            if (this.usedVariables[name] <= 0) delete this.usedVariables[name];
        }
        if (family === 'output' && this.usedOutputVariables[name]) {
            this.usedOutputVariables[name]--;
            if (this.usedOutputVariables[name] <= 0) delete this.usedOutputVariables[name];
        }
        this.updateVariableMonitor();
    },

    updateVariableMonitor() {
        const tbody = document.getElementById('var-tbody');
        if (!tbody) return;

        const typeMap = { 'X': 'Input', 'Y': 'Output', 'M': 'Memory', 'T': 'Timer' };
        const colorMap = { 'X': 'var-x', 'Y': 'var-y', 'M': 'var-m', 'T': 'var-t' };

        // 변수명 정렬: 접두사 순서(X→M→T→Y) → 번호 순
        const order = ['X', 'M', 'T', 'Y'];
        const sorted = Object.keys(this.usedVariables).sort((a, b) => {
            const pa = a.match(/^([A-Z])(\d+)$/);
            const pb = b.match(/^([A-Z])(\d+)$/);
            if (!pa || !pb) return 0;
            const oa = order.indexOf(pa[1]);
            const ob = order.indexOf(pb[1]);
            if (oa !== ob) return oa - ob;
            return parseInt(pa[2]) - parseInt(pb[2]);
        });

        tbody.innerHTML = sorted.map(name => {
            const prefix = name.charAt(0);
            const cls = colorMap[prefix] || '';
            const type = typeMap[prefix] || '?';
            const desc = this.variableComments[name] || '';
            const clickable = prefix === 'X' ? ' class="var-clickable" onclick="Ladder.toggleInput(\'' + name + '\')"' : '';
            return `<tr class="${cls}"${clickable}><td>${name}</td><td>${type}</td><td>-</td><td>${desc}</td></tr>`;
        }).join('');
    },

    validateVariableName(name, family) {
        const prefixes = this.FAMILY_PREFIXES[family];
        if (!prefixes) return false;

        const match = name.match(/^([A-Z])(\d+)$/);
        if (!match) return false;

        const prefix = match[1];
        if (!prefixes.includes(prefix)) return false;

        return true;
    },

    // 접두사에 따라 컴포넌트 변경
    updateComponentByPrefix(td, prefix, family) {
        const newCompType = this.PREFIX_TO_COMP[family][prefix];
        if (!newCompType) return;

        const symbol = td.querySelector('.step-symbol');
        const back = td.querySelector('.step-symbol-back');
        back.innerHTML = `<img src="images/Components/${newCompType}_Normal.svg">`;
        symbol.dataset.component = newCompType;
    },

    // 빈 셀 또는 기존 컴포넌트에서 변수명 직접 입력 (a/b 접미사 지원)
    editStepNameWithCreate(stepNameDiv, td, tr) {
        if (stepNameDiv.querySelector('input')) return;

        const symbol = td.querySelector('.step-symbol');
        const comp = symbol ? symbol.dataset.component : null;
        // 기존 컴포넌트가 있으면 계열 판별, 없으면 contact_a 기본
        let currentFamily = comp ? this.COMP_FAMILY[comp] : null;
        const currentText = stepNameDiv.textContent.trim();

        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentText;
        input.className = 'step-name-input';
        input.placeholder = 'X0, M0a, T1b...';

        stepNameDiv.textContent = '';
        stepNameDiv.appendChild(input);
        input.focus();
        input.select();

        const finish = () => {
            let value = input.value.trim().toUpperCase();

            if (!value) {
                if (currentText) this.unregisterVariable(currentText, currentFamily);
                stepNameDiv.textContent = '';
                return;
            }

            // a/b 접미사 처리
            let contactType = null;
            if (value.endsWith('A')) {
                contactType = 'a';
                value = value.slice(0, -1);
            } else if (value.endsWith('B')) {
                contactType = 'b';
                value = value.slice(0, -1);
            }

            // 변수명 검증 (접두사 + 숫자)
            const match = value.match(/^([A-Z])(\d+)$/);
            if (!match) {
                alert('Error: 잘못된 변수명입니다.\n\n형식: 접두사(X/M/Y/T) + 숫자\n접미사 a/b로 A접점/B접점 전환 가능\n\n예: X0, M1a, T2b');
                stepNameDiv.textContent = currentText;
                return;
            }

            const prefix = match[1];

            // 접두사로 계열 결정
            let family;
            if (contactType === 'b') {
                family = 'contact_b';
            } else if (contactType === 'a') {
                family = 'contact_a';
            } else if (currentFamily === 'contact_a' || currentFamily === 'contact_b') {
                family = currentFamily;
            } else if (currentFamily === 'output') {
                family = 'output';
            } else {
                // 빈 셀: 기본 contact_a
                family = 'contact_a';
            }

            // output 계열인데 X 접두사는 불가
            if (family === 'output' && prefix === 'X') {
                alert('Error: 출력(코일)에 X 변수는 사용할 수 없습니다.');
                stepNameDiv.textContent = currentText;
                return;
            }

            // contact 계열에서 허용 접두사 체크
            const prefixes = this.FAMILY_PREFIXES[family];
            if (!prefixes || !prefixes.includes(prefix)) {
                alert(`Error: 잘못된 변수명입니다.\n\n허용 접두사: ${prefixes ? prefixes.join(', ') : '없음'}`);
                stepNameDiv.textContent = currentText;
                return;
            }

            // 코일 중복 체크
            if (family === 'output' && value !== currentText) {
                const count = this.usedOutputVariables[value] || 0;
                if (count >= 1) {
                    alert(`Error: ${value}는 이미 다른 코일에서 사용 중입니다.\n\n같은 변수의 출력(코일)은 1개만 허용됩니다.`);
                    stepNameDiv.textContent = currentText;
                    return;
                }
            }

            // 빈 셀이면 컴포넌트 생성 + 왼쪽부터 정렬
            const isEmptyCell = !comp || comp === 'Line';
            if (isEmptyCell) {
                const newCompType = this.PREFIX_TO_COMP[family][prefix];
                if (!newCompType) {
                    stepNameDiv.textContent = currentText;
                    return;
                }

                // 자동 배치: 왼쪽부터 정렬
                const cells = Array.from(tr.children);
                const stepTds = cells.slice(2, 2 + this.stepCount);
                const clickedIdx = stepTds.indexOf(td);
                const targetTd = this.findAutoPlaceTd(tr, newCompType, clickedIdx);
                if (!targetTd) {
                    stepNameDiv.textContent = currentText;
                    return;
                }

                // 대상 셀에 컴포넌트 배치
                const targetSymbol = targetTd.querySelector('.step-symbol');
                const targetBack = targetTd.querySelector('.step-symbol-back');
                const targetName = targetTd.querySelector('.step-name');
                targetBack.innerHTML = `<img src="images/Components/${newCompType}_Normal.svg">`;
                targetSymbol.dataset.component = newCompType;

                if (currentText) this.unregisterVariable(currentText, family);
                this.registerVariable(value, family);
                targetName.textContent = value;

                // 원래 셀의 input 정리 (대상이 다른 셀일 수 있음)
                if (targetTd !== td) {
                    stepNameDiv.textContent = '';
                }
                this.syncAllComments();
                return;
            }

            // 기존 컴포넌트: 변수명 변경 + 접두사에 따라 이미지 변경
            if (currentText) this.unregisterVariable(currentText, family);
            this.registerVariable(value, family);
            stepNameDiv.textContent = value;
            this.updateComponentByPrefix(td, prefix, family);
            this.syncAllComments();
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = currentText;
                input.blur();
            }
        });
    },

    editStepName(stepNameDiv, componentType) {
        if (stepNameDiv.querySelector('input')) return;

        const family = this.COMP_FAMILY[componentType];
        if (!family) return;

        const prefixes = this.FAMILY_PREFIXES[family];
        const currentText = stepNameDiv.textContent.trim();
        const suggestion = currentText || this.getNextVariableName(prefixes[0]);

        const input = document.createElement('input');
        input.type = 'text';
        input.value = suggestion;
        input.className = 'step-name-input';
        input.placeholder = `${prefixes.join('/')}0`;

        stepNameDiv.textContent = '';
        stepNameDiv.appendChild(input);
        input.focus();
        input.select();

        const td = stepNameDiv.closest('td');

        const finish = () => {
            const value = input.value.trim().toUpperCase();

            if (!value) {
                this.unregisterVariable(currentText, family);
                stepNameDiv.textContent = '';
                return;
            }

            if (!this.validateVariableName(value, family)) {
                const examples = prefixes.map(p => `${p}0, ${p}1, ${p}2...`).join('\n  ');
                alert(`Error: 잘못된 변수명입니다.\n\n사용 가능한 변수명:\n  ${examples}\n\n형식: 접두사(${prefixes.join('/')}) + 숫자`);
                stepNameDiv.textContent = currentText;
                return;
            }

            // 코일 중복 체크 (output 계열, 중복 금지)
            if (family === 'output' && value !== currentText) {
                const count = this.usedOutputVariables[value] || 0;
                if (count >= 1) {
                    alert(`Error: ${value}는 이미 다른 코일에서 사용 중입니다.\n\n같은 변수의 출력(코일)은 1개만 허용됩니다.`);
                    stepNameDiv.textContent = currentText;
                    return;
                }
            }

            this.unregisterVariable(currentText, family);
            this.registerVariable(value, family);
            stepNameDiv.textContent = value;

            // 접두사에 따라 컴포넌트 이미지 변경
            const prefix = value.match(/^([A-Z])/)[1];
            this.updateComponentByPrefix(td, prefix, family);
            this.syncAllComments();
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = currentText;
                input.blur();
            }
        });
    },

    // === Comment 편집 ===

    editVariableComment(stepCommentDiv, varName) {
        if (stepCommentDiv.querySelector('input')) return;

        const currentText = this.variableComments[varName] || '';
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentText;
        input.className = 'comment-input';

        stepCommentDiv.textContent = '';
        stepCommentDiv.appendChild(input);
        input.focus();

        const finish = () => {
            const value = input.value.trim();
            if (value) {
                this.variableComments[varName] = value;
            } else {
                delete this.variableComments[varName];
            }
            this.syncVariableComments(varName);
            this.updateVariableMonitor();
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = currentText;
                input.blur();
            }
        });
    },

    // 같은 변수명의 모든 step-comment를 동기화
    syncVariableComments(varName) {
        const comment = this.variableComments[varName] || '';
        document.querySelectorAll('#ladder-table tbody .step-cell').forEach(cell => {
            const nameDiv = cell.querySelector('.step-name');
            const commentDiv = cell.querySelector('.step-comment');
            if (nameDiv && commentDiv && nameDiv.textContent.trim() === varName) {
                commentDiv.textContent = comment;
            }
        });
    },

    // 모든 변수의 코멘트를 동기화
    syncAllComments() {
        document.querySelectorAll('#ladder-table tbody .step-cell').forEach(cell => {
            const nameDiv = cell.querySelector('.step-name');
            const commentDiv = cell.querySelector('.step-comment');
            if (nameDiv && commentDiv) {
                const varName = nameDiv.textContent.trim();
                if (varName && this.variableComments[varName]) {
                    commentDiv.textContent = this.variableComments[varName];
                } else if (!varName) {
                    commentDiv.textContent = '';
                }
            }
        });
    },

    editComment(td) {
        if (td.querySelector('input')) return;

        const currentText = td.textContent.trim();
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentText;
        input.className = 'comment-input';

        td.textContent = '';
        td.appendChild(input);
        input.focus();

        const finish = () => {
            const value = input.value.trim();
            td.textContent = value;
        };

        input.addEventListener('blur', finish);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') input.blur();
            if (e.key === 'Escape') {
                input.value = currentText;
                input.blur();
            }
        });
    },

    // === Rung 선택/삭제/추가 ===

    selectRung(tr, ctrlKey) {
        if (ctrlKey) {
            // Ctrl+Click: 다중 선택 토글
            if (tr.classList.contains('rung-selected')) {
                tr.classList.remove('rung-selected');
                this.selectedRows = this.selectedRows.filter(r => r !== tr);
                if (this.selectedRow === tr) {
                    this.selectedRow = this.selectedRows.length > 0 ? this.selectedRows[this.selectedRows.length - 1] : null;
                }
            } else {
                tr.classList.add('rung-selected');
                this.selectedRows.push(tr);
                this.selectedRow = tr;
            }
        } else {
            // 일반 클릭: 단일 선택
            this.clearMultiSelection();
            if (this.selectedRow) {
                this.selectedRow.classList.remove('rung-selected');
            }
            if (this.selectedRow === tr) {
                this.selectedRow = null;
                return;
            }
            tr.classList.add('rung-selected');
            this.selectedRow = tr;
            this.selectedRows = [tr];
        }
    },

    deleteRung() {
        const tbody = document.querySelector('#ladder-table tbody');
        const tr = this.selectedRow;

        // branch 행 삭제
        if (tr.classList.contains('rung-branch')) {
            // 메인 행의 대응하는 vertical line(v-down)도 제거
            const prevRow = tr.previousElementSibling;
            if (prevRow && !prevRow.classList.contains('rung-branch')) {
                // branch의 v-up 위치 확인 후 메인의 같은 열에서 v-down 제거
                const branchCells = Array.from(tr.children).slice(2, 2 + this.stepCount);
                const mainCells = Array.from(prevRow.children).slice(2, 2 + this.stepCount);
                branchCells.forEach((btd, i) => {
                    const bCell = btd.querySelector('.step-cell');
                    if (bCell && bCell.querySelector('.vertical-line.v-up')) {
                        const mCell = mainCells[i] ? mainCells[i].querySelector('.step-cell') : null;
                        if (mCell) {
                            const vDown = mCell.querySelector('.vertical-line.v-down');
                            if (vDown) vDown.remove();
                        }
                    }
                });
            }
            tr.remove();
            this.selectedRow = null;
            return;
        }

        // 메인 행 삭제
        const rows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
        if (rows.length <= 1) return;

        // branch row도 함께 삭제
        let next = tr.nextElementSibling;
        tr.remove();
        while (next && next.classList.contains('rung-branch')) {
            const toRemove = next;
            next = next.nextElementSibling;
            toRemove.remove();
        }

        this.selectedRow = null;
        this.renumberRungs();
    },

    renumberRungs() {
        const tbody = document.querySelector('#ladder-table tbody');
        const rows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
        rows.forEach((row, i) => {
            row.children[1].textContent = i;
        });
        this.rungCount = rows.length;
        this.updateLineNumWidth();
    },

    isRungEmpty(tr) {
        const cells = Array.from(tr.children).slice(2, 2 + this.stepCount);
        return cells.every(td => {
            const symbol = td.querySelector('.step-symbol');
            const hasVertical = td.querySelector('.vertical-line');
            if (hasVertical) return false;
            if (!symbol || !symbol.dataset.component) return true;
            if (symbol.dataset.component === 'Output_Basic') return true;
            return false;
        });
    },

    addRung() {
        const tbody = document.querySelector('#ladder-table tbody');
        const addRow = tbody.querySelector('.rung-add');

        // 맨 아래 rung이 비어있으면 추가 안 함
        const mainRows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
        const lastRow = mainRows[mainRows.length - 1];
        if (lastRow && this.isRungEmpty(lastRow)) return;

        const tr = document.createElement('tr');
        tr.className = 'rung-row';

        let cells = `<td></td><td>${this.rungCount}</td>`;
        for (let i = 0; i < this.stepCount; i++) {
            cells += this.STEP_CELL_HTML;
        }
        cells += '<td></td>';
        tr.innerHTML = cells;

        tbody.insertBefore(tr, addRow);
        this.setDefaultOutput(tr);
        this.rungCount++;
        this.updateLineNumWidth();
    },

    // 메인 행의 outputCol에 Output_Basic 기본값 설정
    setDefaultOutput(tr) {
        const cells = Array.from(tr.children);
        const outputTd = cells[2 + this.outputCol];
        if (!outputTd) return;
        const symbol = outputTd.querySelector('.step-symbol');
        const back = outputTd.querySelector('.step-symbol-back');
        if (symbol && back && !symbol.dataset.component) {
            back.innerHTML = '<img src="images/Components/Output_Basic_Normal.svg">';
            symbol.dataset.component = 'Output_Basic';
        }
    },

    // === 패널 리사이즈 ===

    initResize(handleId, panelId, side) {
        const handle = document.getElementById(handleId);
        const panel = document.getElementById(panelId);
        if (!handle || !panel) return;

        let startX, startWidth;

        handle.addEventListener('mousedown', (e) => {
            startX = e.clientX;
            startWidth = panel.offsetWidth;
            handle.classList.add('active');
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';

            const onMove = (e) => {
                const diff = e.clientX - startX;
                const newWidth = side === 'left'
                    ? startWidth + diff
                    : startWidth - diff;
                panel.style.width = Math.max(100, newWidth) + 'px';
            };

            const onUp = () => {
                handle.classList.remove('active');
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    },

    // Comment 열 리사이즈: #열(2번째 td/th) 드래그
    initColResize() {
        const table = document.getElementById('ladder-table');
        const col = document.querySelector('#ladder-table colgroup col:first-child');
        if (!table || !col) return;

        let startX, startWidth, dragging = false;

        table.addEventListener('mousedown', (e) => {
            const td = e.target.closest('td, th');
            if (!td) return;
            const tr = td.closest('tr');
            if (!tr) return;
            const cells = Array.from(tr.children);
            if (cells.indexOf(td) !== 1) return;

            e.preventDefault();
            dragging = true;
            startX = e.clientX;
            startWidth = parseInt(col.style.width) || 150;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const diff = e.clientX - startX;
            col.style.width = Math.max(80, startWidth + diff) + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        });
    },

    // === # 열 자동 너비 ===

    updateLineNumWidth() {
        const maxNum = this.rungCount - 1;
        const digits = String(maxNum).length;
        const width = Math.max(20, digits * 10 + 10);
        const col = document.querySelector('#ladder-table colgroup col:nth-child(2)');
        if (col) col.style.width = width + 'px';
    },

    // === Run/Stop ===

    save() {
        const csv = this.exportCSV();
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ladder_project.csv';
        a.click();
        URL.revokeObjectURL(url);
    },

    load() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.csv';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                this.importCSV(ev.target.result);
            };
            reader.readAsText(file);
        });
        input.click();
    },

    exportCSV() {
        const lines = [];

        // [meta] 섹션
        lines.push('[meta]');
        lines.push('key,value');
        lines.push(`version,1.0`);
        lines.push(`stepCount,${this.stepCount}`);
        lines.push(`outputCol,${this.outputCol}`);
        lines.push(`savedAt,${new Date().toISOString()}`);
        lines.push('');

        // [ladder] 섹션
        lines.push('[ladder]');
        const header = ['rung', 'type', 'comment'];
        for (let i = 0; i < this.stepCount; i++) {
            header.push(`s${i}`);
            if (i < this.stepCount - 1) header.push(`v${i}`);
        }
        lines.push(header.join(','));

        const tbody = document.querySelector('#ladder-table tbody');
        const rows = tbody.querySelectorAll('.rung-row:not(.rung-add)');

        let currentRung = -1;
        rows.forEach(row => {
            const isBranch = row.classList.contains('rung-branch');
            const cells = Array.from(row.children);

            if (!isBranch) {
                currentRung++;
            }

            const rungComment = isBranch ? '' : this.escapeCSV(cells[0].textContent.trim());
            const type = isBranch ? 'branch' : 'main';

            const stepTds = cells.slice(2, 2 + this.stepCount);
            const values = [currentRung, type, rungComment];

            for (let i = 0; i < this.stepCount; i++) {
                const td = stepTds[i];
                if (!td) { values.push(''); if (i < this.stepCount - 1) values.push(''); continue; }

                const symbol = td.querySelector('.step-symbol');
                const nameDiv = td.querySelector('.step-name');
                const comp = symbol ? symbol.dataset.component : '';
                const varName = nameDiv ? nameDiv.textContent.trim() : '';

                // step 값: 계열:변수명, Line은 'line', 메인 빈 셀도 'line'
                if (comp === 'Line') {
                    values.push('line');
                } else if (comp && comp !== 'Output_Basic') {
                    const family = this.COMP_FAMILY[comp] || '';
                    values.push(varName ? `${family}:${varName}` : family);
                } else if (!comp && !isBranch) {
                    values.push('line');
                } else {
                    values.push('');
                }

                // vertical line 값 (마지막 step 제외)
                if (i < this.stepCount - 1) {
                    const cell = td.querySelector('.step-cell');
                    const hasVDown = cell && cell.querySelector('.vertical-line.v-down');
                    const hasVUp = cell && cell.querySelector('.vertical-line.v-up');
                    if (hasVDown) values.push('d');
                    else if (hasVUp) values.push('u');
                    else values.push('');
                }
            }

            lines.push(values.join(','));
        });

        // [variables] 섹션
        lines.push('');
        lines.push('[variables]');
        lines.push('name,comment');
        Object.keys(this.variableComments).sort().forEach(name => {
            lines.push(`${name},${this.escapeCSV(this.variableComments[name])}`);
        });

        return lines.join('\n');
    },

    escapeCSV(str) {
        if (!str) return '';
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
            return '"' + str.replace(/"/g, '""') + '"';
        }
        return str;
    },

    importCSV(csvText) {
        const lines = csvText.split('\n').map(l => l.trim()).filter(l => l);
        let section = '';
        let meta = {};
        let ladderRows = [];
        let variables = {};

        for (const line of lines) {
            if (line === '[meta]') { section = 'meta'; continue; }
            if (line === '[ladder]') { section = 'ladder'; continue; }
            if (line === '[variables]') { section = 'variables'; continue; }
            if (line.startsWith('rung,') || line.startsWith('name,') || line.startsWith('key,')) continue; // 헤더 스킵

            if (section === 'meta') {
                const parts = line.split(',');
                if (parts[0]) meta[parts[0]] = parts[1];
            } else if (section === 'ladder') {
                ladderRows.push(line.split(','));
            } else if (section === 'variables') {
                const parts = line.split(',');
                if (parts[0]) variables[parts[0]] = parts.slice(1).join(',').replace(/^"|"$/g, '');
            }
        }

        // 기존 래더 초기화
        this.clearAll();

        // 래더 복원
        for (const row of ladderRows) {
            const rungNum = parseInt(row[0]);
            const type = row[1];
            const comment = row[2] || '';

            // 새 rung 필요 시 추가
            if (type === 'main') {
                if (rungNum > 0) this.addRung();

                // rung comment 설정
                const tbody = document.querySelector('#ladder-table tbody');
                const mainRows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
                const tr = mainRows[mainRows.length - 1];
                if (tr && comment) tr.children[0].textContent = comment;
            }

            // 현재 행 찾기
            const tbody = document.querySelector('#ladder-table tbody');
            let tr;
            if (type === 'branch') {
                const mainRows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
                const mainRow = mainRows[rungNum];
                if (!mainRow) continue;

                // branch row 생성
                tr = mainRow.nextElementSibling;
                if (!tr || !tr.classList.contains('rung-branch')) {
                    tr = this.createBranchRow(mainRow);
                }
            } else {
                const mainRows = tbody.querySelectorAll('.rung-row:not(.rung-add):not(.rung-branch)');
                tr = mainRows[rungNum];
            }
            if (!tr) continue;

            const cells = Array.from(tr.children);
            const stepTds = cells.slice(2, 2 + this.stepCount);

            // step과 vertical line 복원
            let colIdx = 3; // row[3]부터 데이터
            for (let i = 0; i < this.stepCount; i++) {
                const stepVal = row[colIdx] || '';
                colIdx++;

                // step 배치
                if (stepVal && stepVal !== '') {
                    const td = stepTds[i];
                    if (!td) { if (i < this.stepCount - 1) colIdx++; continue; }
                    const symbol = td.querySelector('.step-symbol');
                    const back = td.querySelector('.step-symbol-back');

                    // horizontal line
                    if (stepVal === 'line') {
                        back.innerHTML = `<img src="images/Components/Line_Normal.svg">`;
                        symbol.dataset.component = 'Line';
                    } else {
                    // 계열:변수명 → 접두사로 컴포넌트 결정
                    const parts = stepVal.split(':');
                    const family = parts[0];
                    const varName = parts[1] || '';
                    const nameDiv = td.querySelector('.step-name');

                    // 변수명 접두사로 컴포넌트 타입 결정
                    const prefix = varName ? varName.charAt(0) : '';
                    const compType = (prefix && this.PREFIX_TO_COMP[family])
                        ? this.PREFIX_TO_COMP[family][prefix]
                        : null;

                    if (compType) {
                        back.innerHTML = `<img src="images/Components/${compType}_Normal.svg">`;
                        symbol.dataset.component = compType;
                    }
                    if (varName && nameDiv) {
                        nameDiv.textContent = varName;
                        this.registerVariable(varName, family);
                    }
                    }
                }

                // vertical line (마지막 step 제외)
                if (i < this.stepCount - 1) {
                    const vVal = row[colIdx] || '';
                    colIdx++;

                    if (vVal === 'd' || vVal === 'u') {
                        const td = stepTds[i];
                        if (td) {
                            const cell = td.querySelector('.step-cell');
                            if (cell) {
                                const dir = vVal === 'd' ? 'v-down' : 'v-up';
                                this.addVerticalLine(cell, 'right', dir);
                            }
                        }
                    }
                }
            }
        }

        // variables 복원
        this.variableComments = variables;
        this.syncAllComments();
        this.updateVariableMonitor();
    },

    clearAll() {
        const tbody = document.querySelector('#ladder-table tbody');
        const rows = tbody.querySelectorAll('.rung-row:not(.rung-add)');
        rows.forEach(row => row.remove());

        this.usedVariables = {};
        this.usedOutputVariables = {};
        this.variableComments = {};
        this.rungCount = 0;
        this.selectedRow = null;
        this.selectedStep = null;
        this.selectedVertical = null;

        // 초기 rung 1개 추가
        this.addRung();
    },

    toggleRun() {
        if (this.running) {
            this.stopRun();
        } else {
            this.startRun();
        }
    },

    startRun() {
        const csv = this.exportCSV();

        // WebSocket 연결
        const wsUrl = `ws://${location.hostname}:8000/ws`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
            this.running = true;
            document.body.classList.add('running-mode');
            const btn = document.getElementById('btn-run');
            btn.textContent = 'Stop';
            btn.className = 'toolbar-btn btn-stop';

            // CSV 전송하여 실행 시작
            this.ws.send(JSON.stringify({
                action: 'run',
                csv: csv
            }));
        };

        this.ws.onmessage = (e) => {
            const data = JSON.parse(e.data);

            if (data.type === 'io_state') {
                this.updateIOState(data.io, data.scan_count);
            } else if (data.type === 'code_generated') {
                console.log('Generated code:', data.code);
            } else if (data.type === 'stopped') {
                console.log('PLC stopped');
            }
        };

        this.ws.onclose = () => {
            this.running = false;
            document.body.classList.remove('running-mode');
            const btn = document.getElementById('btn-run');
            btn.textContent = 'Run';
            btn.className = 'toolbar-btn btn-run';
        };

        this.ws.onerror = (err) => {
            console.error('WebSocket error:', err);
            alert('Error: 백엔드 서버에 연결할 수 없습니다.\n\npython main.py로 서버를 시작해주세요.');
            this.running = false;
            document.body.classList.remove('running-mode');
            const btn = document.getElementById('btn-run');
            btn.textContent = 'Run';
            btn.className = 'toolbar-btn btn-run';
        };
    },

    stopRun() {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify({ action: 'stop' }));
            this.ws.close();
        }
        this.running = false;
        document.body.classList.remove('running-mode');
        const btn = document.getElementById('btn-run');
        btn.textContent = 'Run';
        btn.className = 'toolbar-btn btn-run';
        this.resetLadderImages();
    },

    resetLadderImages() {
        document.querySelectorAll('#ladder-table tbody .step-cell').forEach(cell => {
            const symbol = cell.querySelector('.step-symbol');
            const back = cell.querySelector('.step-symbol-back');
            if (!symbol || !back) return;

            // 통전 상태 초기화
            delete cell.dataset.energized;

            const comp = symbol.dataset.component;

            // Line: 이미지 제거하고 CSS 배경 복원
            if (!comp) {
                back.innerHTML = '';
                back.style.background = '';
                return;
            }
            if (comp === 'Line') {
                back.innerHTML = '<img src="images/Components/Line_Normal.svg">';
                back.style.background = 'none';
                return;
            }

            if (comp === 'Output_Basic') {
                back.innerHTML = '<img src="images/Components/Output_Basic_Normal.svg">';
                return;
            }

            const imgSrc = `images/Components/${comp}_Normal.svg`;
            back.innerHTML = `<img src="${imgSrc}">`;
        });

        // Vertical line 색상 초기화
        document.querySelectorAll('#ladder-table tbody .vertical-line').forEach(vline => {
            vline.style.background = '#000';
        });
    },

    // I/O 상태를 Variable Monitor에 반영
    updateIOState(ioState) {
        this.lastIOState = ioState;
        const tbody = document.getElementById('var-tbody');
        if (!tbody) return;

        // Value 열 업데이트
        const rows = tbody.querySelectorAll('tr');
        rows.forEach(row => {
            const varName = row.children[0] ? row.children[0].textContent : '';
            const valueCell = row.children[2]; // Value는 3번째 열
            if (valueCell && varName in ioState) {
                const val = ioState[varName];
                valueCell.textContent = val ? 'ON' : 'OFF';
                valueCell.style.color = val ? '#22aa22' : '#cc2222';
                valueCell.style.fontWeight = '600';
            }
        });

        // 통전 상태 계산 후 이미지 업데이트
        this.calculateEnergized(ioState);


        this.updateLadderImages(ioState);
    },

    // 컴포넌트 상태에 따라 이미지를 변경하는 규칙 (val=변수값, e=통전여부)
    COMP_STATE_SUFFIX: {
        // A접점(NO): 변수ON+통전 → Connected, 변수ON → Operated, 그 외 → Normal
        'PB_A': (val, e) => (val && e) ? 'Connected' : val ? 'Operated' : 'Normal',
        'Contact_Memory_A': (val, e) => (val && e) ? 'Connected' : val ? 'Operated' : 'Normal',
        'Contact_Timer_A': (val, e) => (val && e) ? 'Connected' : val ? 'Operated' : 'Normal',
        'Contact_Y_A': (val, e) => (val && e) ? 'Connected' : val ? 'Operated' : 'Normal',
        // B접점(NC): 변수OFF+통전 → Connected, 변수ON → Operated, 그 외 → Normal
        'PB_B': (val, e) => (!val && e) ? 'Connected' : val ? 'Operated' : 'Normal',
        'Contact_Memory_B': (val, e) => (!val && e) ? 'Connected' : val ? 'Operated' : 'Normal',
        'Contact_Timer_B': (val, e) => (!val && e) ? 'Connected' : val ? 'Operated' : 'Normal',
        'Contact_Y_B': (val, e) => (!val && e) ? 'Connected' : val ? 'Operated' : 'Normal',
        // 출력: 변수 ON → Connected, OFF → Normal
        'Output_Y': (val) => val ? 'Connected' : 'Normal',
        'Output_Timer': (val) => val ? 'Connected' : 'Normal',
        'Function_Memory': (val) => val ? 'Connected' : 'Normal',
    },

    // 각 셀의 통전 상태 계산
    calculateEnergized(ioState) {
        const tbody = document.querySelector('#ladder-table tbody');
        const allRows = tbody.querySelectorAll('.rung-row:not(.rung-add)');

        // 렁 단위로 그룹화 (main + branches)
        const rungGroups = [];
        let currentGroup = null;

        allRows.forEach(row => {
            if (!row.classList.contains('rung-branch')) {
                currentGroup = { main: row, branches: [] };
                rungGroups.push(currentGroup);
            } else if (currentGroup) {
                currentGroup.branches.push(row);
            }
        });

        // 각 렁 그룹에 대해 통전 계산
        rungGroups.forEach(group => {
            const mainCells = Array.from(group.main.children).slice(2, 2 + this.stepCount);

            // v-down 위치 수집 (main row)
            const vdownCols = new Set();
            mainCells.forEach((td, i) => {
                const cell = td.querySelector('.step-cell');
                if (cell && cell.querySelector('.vertical-line.v-down')) {
                    vdownCols.add(i);
                }
            });

            // branch의 v-up 위치 수집
            const vupCols = new Set();
            group.branches.forEach(branchRow => {
                const branchCells = Array.from(branchRow.children).slice(2, 2 + this.stepCount);
                branchCells.forEach((td, i) => {
                    const cell = td.querySelector('.step-cell');
                    if (cell && cell.querySelector('.vertical-line.v-up')) {
                        vupCols.add(i);
                    }
                });
            });

            // main row 통전 계산
            const mainEnergized = this._calcRowEnergized(mainCells, ioState);

            // branch rows 통전 계산
            const branchEnergizedArrays = group.branches.map(branchRow => {
                const branchCells = Array.from(branchRow.children).slice(2, 2 + this.stepCount);

                // branch 시작점: v-up 위치의 main 통전 상태를 전달
                const branchEnergized = this._calcBranchEnergized(branchCells, ioState, mainEnergized);
                return branchEnergized;
            });

            // 합류: 각 branch의 마지막 v-up 위치에서 main과 OR
            branchEnergizedArrays.forEach((be, bi) => {
                const branchRow = group.branches[bi];
                const branchCells = Array.from(branchRow.children).slice(2, 2 + this.stepCount);

                // 이 branch의 마지막 v-up 위치 찾기 (합류점)
                let mergeCol = -1;
                for (let i = branchCells.length - 1; i >= 0; i--) {
                    const cell = branchCells[i].querySelector('.step-cell');
                    if (cell && cell.querySelector('.vertical-line.v-up')) {
                        mergeCol = i;
                        break;
                    }
                }

                if (mergeCol >= 0) {
                    const branchResult = be[mergeCol];
                    const merged = mainEnergized[mergeCol] || branchResult;

                    if (merged !== mainEnergized[mergeCol]) {
                        mainEnergized[mergeCol] = merged;
                        // 합류점 이후 재계산
                        for (let i = mergeCol + 1; i < this.stepCount; i++) {
                            mainEnergized[i] = this._evalCellEnergized(mainCells[i], ioState, mainEnergized[i - 1]);
                        }
                    }
                }
            });

            // 결과를 data-energized에 저장
            mainCells.forEach((td, i) => {
                const cell = td.querySelector('.step-cell');
                if (cell) cell.dataset.energized = mainEnergized[i] ? 'true' : 'false';
            });

            group.branches.forEach((branchRow, bi) => {
                const branchCells = Array.from(branchRow.children).slice(2, 2 + this.stepCount);
                const be = branchEnergizedArrays[bi] || [];
                branchCells.forEach((td, i) => {
                    const cell = td.querySelector('.step-cell');
                    if (cell) cell.dataset.energized = be[i] ? 'true' : 'false';
                });
            });
        });
    },

    _evalCellEnergized(td, ioState, prevEnergized) {
        if (!td) return false;
        const symbol = td.querySelector('.step-symbol');
        const nameDiv = td.querySelector('.step-name');
        const comp = symbol ? symbol.dataset.component : '';
        const varName = nameDiv ? nameDiv.textContent.trim() : '';

        if (!comp || comp === 'Line' || comp === 'Output_Basic') {
            return prevEnergized;
        }

        const family = this.COMP_FAMILY[comp];
        if (family === 'contact_a') {
            return prevEnergized && (varName in ioState ? ioState[varName] : false);
        } else if (family === 'contact_b') {
            return prevEnergized && (varName in ioState ? !ioState[varName] : true);
        } else if (family === 'output') {
            return prevEnergized;
        }

        return prevEnergized;
    },

    _calcRowEnergized(cells, ioState) {
        const energized = [];
        let prev = true; // Load 선에서 시작

        for (let i = 0; i < cells.length; i++) {
            prev = this._evalCellEnergized(cells[i], ioState, prev);
            energized.push(prev);
        }

        return energized;
    },

    _calcBranchEnergized(branchCells, ioState, mainEnergized) {
        const energized = [];
        let prev = false;
        let inBranch = false; // v-up 사이에서만 통전 계산

        // v-up 위치 수집
        const vupPositions = [];
        for (let i = 0; i < branchCells.length; i++) {
            const cell = branchCells[i].querySelector('.step-cell');
            if (cell && cell.querySelector('.vertical-line.v-up')) {
                vupPositions.push(i);
            }
        }

        // 첫 번째 v-up = 분기 시작, 마지막 v-up = 합류
        const startCol = vupPositions.length > 0 ? vupPositions[0] : -1;
        const endCol = vupPositions.length > 1 ? vupPositions[vupPositions.length - 1] : startCol;

        for (let i = 0; i < branchCells.length; i++) {
            if (i === startCol) {
                // 분기 시작: main의 같은 위치 통전 상태를 받음
                prev = mainEnergized[i];
                inBranch = true;
            }

            if (inBranch) {
                prev = this._evalCellEnergized(branchCells[i], ioState, prev);
            } else {
                prev = false;
            }

            energized.push(prev);

            if (i === endCol && inBranch) {
                inBranch = false; // 합류 이후는 통전 계산 중단
            }
        }

        return energized;
    },

    updateLadderImages(ioState) {
        document.querySelectorAll('#ladder-table tbody .step-cell').forEach(cell => {
            const symbol = cell.querySelector('.step-symbol');
            const nameDiv = cell.querySelector('.step-name');
            const back = cell.querySelector('.step-symbol-back');
            if (!symbol || !back) return;

            const comp = symbol.dataset.component;
            const varName = nameDiv ? nameDiv.textContent.trim() : '';
            const isEnergized = cell.dataset.energized === 'true';

            // Line: 통전 상태에 따라 Normal/Connected
            if (!comp || comp === 'Line') {
                const isBranchCell = cell.classList.contains('branch-cell');
                if (isBranchCell && !isEnergized) {
                    back.innerHTML = '';
                    back.style.background = 'none';
                } else {
                    const lineSuffix = isEnergized ? 'Connected' : 'Normal';
                    const lineSrc = `images/Components/Line_${lineSuffix}.svg`;
                    const img = back.querySelector('img');
                    if (img && img.src.endsWith(lineSrc)) return;
                    back.innerHTML = `<img src="${lineSrc}">`;
                    back.style.background = 'none';
                }
                return;
            }

            // Output_Basic: 통전 상태에 따라 변경
            if (comp === 'Output_Basic') {
                const suffix = isEnergized ? 'Connected' : 'Normal';
                const imgSrc = `images/Components/Output_Basic_${suffix}.svg`;
                const img = back.querySelector('img');
                if (img && img.src.endsWith(imgSrc)) return;
                back.innerHTML = `<img src="${imgSrc}">`;
                return;
            }

            // 컴포넌트: 변수 상태에 따라 이미지 변경
            if (!varName || !(varName in ioState)) return;

            const stateFunc = this.COMP_STATE_SUFFIX[comp];
            if (!stateFunc) return;

            const suffix = stateFunc(ioState[varName], isEnergized);
            const imgSrc = `images/Components/${comp}_${suffix}.svg`;
            const img = back.querySelector('img');
            if (img && img.src.endsWith(imgSrc)) return;
            back.innerHTML = `<img src="${imgSrc}">`;
        });

        // Vertical line 통전 상태
        document.querySelectorAll('#ladder-table tbody .vertical-line').forEach(vline => {
            const cell = vline.closest('.step-cell');
            const isEnergized = cell && cell.dataset.energized === 'true';
            vline.style.background = isEnergized ? '#0000ff' : '#000';
        });
    },

    // X 변수 입력 토글 (클릭으로 ON/OFF)
    toggleInput(varName) {
        if (!this.running || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        if (!varName.startsWith('X')) return;

        this.ws.send(JSON.stringify({
            action: 'set_input',
            var: varName,
            value: !this.lastIOState[varName]
        }));
    }
};

document.addEventListener('DOMContentLoaded', () => Ladder.init());
