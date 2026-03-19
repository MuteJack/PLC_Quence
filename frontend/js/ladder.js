const Ladder = {
    rungCount: 1,
    stepCount: 10,

    init() {
        document.querySelector('.btn-add-rung').addEventListener('click', () => this.addRung());
    },

    addRung() {
        const tbody = document.querySelector('#ladder-table tbody');
        const addRow = tbody.querySelector('.rung-add');

        const tr = document.createElement('tr');
        tr.className = 'rung-row';

        let cells = `<td></td><td>${this.rungCount}</td>`;
        for (let i = 0; i < this.stepCount; i++) {
            cells += '<td></td>';
        }
        cells += '<td></td>';
        tr.innerHTML = cells;

        tbody.insertBefore(tr, addRow);
        this.rungCount++;
    }
};

document.addEventListener('DOMContentLoaded', () => Ladder.init());
