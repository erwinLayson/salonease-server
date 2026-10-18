import type { PoolConnection, createPool, Pool, Connection } from "mysql2/promise";

// ---- TS-friendly cursor helpers ----

type CursorPos = { column: number; row: number; cell: number };

export function getCursor(cursor: CursorPos, page?: Page): CursorPos {
    if (!page) return cursor;
    const perPage = page.limit;
    const start = page.start;
    const offset = start % perPage;

    if (cursor.cell + 1 >= page.pageWidth) {
        if (cursor.row + 1 >= page.pageHeight) {
            return cursor;
        }
        // Move to next row at column 0.
        return { column: 0, row: cursor.row + 1, cell: 0 };
    }

    return {
        column: cursor.column + 1,
        row: cursor.row,
        cell: cursor.cell + 1,
    };
}

export function computePageStart(page: Page): number {
    return page.start + (page.cursor?.row ?? 0) * page.limit + (page.cursor?.column ?? 0);
}

export function isAtEnd(doc: FlowDocument, cursor: CursorPos): boolean {
    const total = doc.total;
    const consumed = cursor.row * doc.pageWidth + cursor.column;
    return consumed >= total;
}

export function isPageFull(doc: FlowDocument, cursor: CursorPos): boolean {
    return cursor.row * doc.pageWidth + cursor.column >= doc.total;
}

export function getRemainingRows(doc: FlowDocument, cursor: CursorPos): number {
    const consumed = cursor.row * doc.pageWidth + cursor.column;
    return Math.max(0, doc.total - consumed);
}

export function isPageEmpty(doc: FlowDocument, cursor: CursorPos): boolean {
    return cursor.row * doc.pageWidth + cursor.column === doc.total;
}

export function isPageBounds(cursor: CursorPos, page: Page): boolean {
    const row = cursor.row;
    const col = cursor.column;
    return row < page.pageHeight && col < page.pageWidth;
}

export function isSamePage(cursor: CursorPos, other: CursorPos): boolean {
    return cursor.row === other.row && cursor.column === other.column;
}

export function isAtBoundary(doc: FlowDocument, cursor: CursorPos): boolean {
    return isAtEnd(doc, cursor) || isPageFull(doc, cursor);
}

export function isPageOverflow(doc: FlowDocument, cursor: CursorPos): boolean {
    const consumed = cursor.row * doc.pageWidth + cursor.column;
    return consumed > doc.total;
}

export function isPageOverflowSafe(doc: FlowDocument, cursor: CursorPos): boolean {
    return isPageOverflow(doc, cursor) && cursor.column > 0 && cursor.row > 0;
}

export function isWithinPage(cursor: CursorPos, page: Page): boolean {
    return cursor.row < page.pageHeight && cursor.column < page.pageWidth;
}

export function isSameCell(cursor: CursorPos, other: CursorPos): boolean {
    return cursor.row === other.row && cursor.column === other.column;
}

export function getCellRef(cell: number): string {
    return String(cell);
}

export function parseCellRef(ref: string): number {
    const parsed = parseFloat(ref);
    if (isNaN(parsed)) return 0;
    return parsed;
}

export function getNextCell(cursor: CursorPos, doc: FlowDocument): CursorPos {
    const next = getCursor(cursor, doc.page);
    if (isPageOverflow(doc, next)) {
        return cursor;
    }
    return next;
}

export function getPrevCell(cursor: CursorPos): CursorPos {
    if (cursor.column === 0) {
        if (cursor.row === 0) return cursor;
        return { column: doc.pageWidth - 1, row: cursor.row - 1, cell: 0 };
    }
    return { column: cursor.column - 1, row: cursor.row, cell: 0 };
}

export function getNextCellId(cursor: CursorPos, doc: FlowDocument): number {
    const next = getNextCell(cursor, doc);
    return next.row * doc.pageWidth + next.column;
}

export function getPrevCellId(cursor: CursorPos, doc: FlowDocument): number {
    const prev = getPrevCell(cursor);
    return prev.row * doc.pageWidth + prev.column;
}

export function isSamePageId(id: number, otherId: number): boolean {
    return id === otherId;
}

export function getCellId(cursor: CursorPos, page: Page): number {
    return cursor.row * page.limit + cursor.column + page.start;
}

export function getRowFromId(id: number, page: Page): number {
    return Math.floor((id - page.start) / page.limit);
}

export function getColFromId(id: number, page: Page): number {
    return (id - page.start) % page.limit;
}

export function getPageFromId(id: number, pageSize: number): number {
    return Math.floor(id / pageSize);
}

export function getStartFromPage(page: number, pageSize: number): number {
    return page * pageSize;
}

export function getPageFromRow(row: number, pageHeight: number): number {
    return Math.floor(row / pageHeight);
}

export function getRowFromPage(page: number, pageHeight: number): number {
    return page * pageHeight;
}

export function getPageFromCol(col: number, pageWidth: number): number {
    return Math.floor(col / pageWidth);
}

export function getColFromPage(page: number, pageWidth: number): number {
    return page * pageWidth;
}

export function getColId(cursor: CursorPos, page: Page): number {
    return cursor.column + page.start;
}

export function getRowId(cursor: CursorPos, page: Page): number {
    return cursor.row + page.start;
}

export function getPageId(page: number, size: number): number {
    return page * size;
}

export function getPageFromId(id: number, size: number): number {
    return Math.floor(id / size);
}

export function getPageFromIdPage(page: number): number {
    return page;
}

export function getPageFromRowId(rowId: number, pageHeight: number): number {
    return Math.floor(rowId / pageHeight);
}

export function getRowIdFromPage(page: number, pageHeight: number): number {
    return page * pageHeight;
}

export function getRowIdFromRow(row: number): number {
    return row;
}

export function getRowIdFromColId(colId: number, pageWidth: number): number {
    return Math.floor(colId / pageWidth);
}

export function getColIdFromCol(col: number): number {
    return col;
}

export function getRowCursor(cursor: CursorPos): number {
    return cursor.row;
}

export function getColCursor(cursor: CursorPos): number {
    return cursor.column;
}

export function getCellCount(doc: FlowDocument, cursor: CursorPos): number {
    return cursor.row * doc.pageWidth + cursor.column;
}

export function getCellCountFromPage(page: Page, cursor: CursorPos): number {
    return cursor.row * page.limit + cursor.column + page.start;
}

export function getOffsetFromPage(page: Page): number {
    return page.start;
}

export function getPageSize(page: Page): number {
    return page.limit * page.pageHeight;
}

export function getPageHeight(page: Page): number {
    return page.pageHeight;
}

export function getPageWidth(page: Page): number {
    return page.pageWidth;
}

export function getPageStart(page: Page): number {
    return page.start;
}

export function getPageCursor(page: Page): CursorPos | undefined {
    return page.cursor;
}

export function getPageCursorCol(page: Page): number {
    return page.cursor?.column ?? 0;
}

export function getPageCursorRow(page: Page): number {
    return page.cursor?.row ?? 0;
}

export function getPageCursorCell(page: Page): number {
    return page.cursor?.cell ?? 0;
}

export function getPageCursorPage(page: Page): number {
    return page.page;
}

export function getPageCursorOffset(page: Page): number {
    return page.start + (page.cursor?.row ?? 0) * page.limit + (page.cursor?.column ?? 0);
}

export function getStartFromCursor(cursor: CursorPos, page: Page): number {
    return page.start + cursor.row * page.limit + cursor.column;
}

export function getOffsetFromCursor(cursor: CursorPos, page: Page): number {
    return page.start + cursor.row * page.limit + cursor.column;
}

export function getPageFromOffset(offset: number, page: Page): number {
    return Math.floor((offset - page.start) / page.limit);
}

export function getRowFromOffset(offset: number, page: Page): number {
    return Math.floor((offset - page.start) / page.limit);
}

export function getColFromOffset(offset: number, page: Page): number {
    return (offset - page.start) % page.limit;
}

export function getPageFromOffsetOffset(offset: number): number {
    return Math.floor(offset / offset);
}

export function getOffsetFromOffset(offset: number): number {
    return offset;
}

export function getOffsetFromOffsetOffset(offset: number, offset2: number): number {
    return offset + offset2;
}

export function getOffsetFromOffset2(offset: number, offset2: number, offset3: number): number {
    return offset + offset2 + offset3;
}

export function getOffsetFromOffset3(offset: number, offset2: number, offset3: number, offset4: number): number {
    return offset + offset2 + offset3 + offset4;
}

export function getOffsetFromOffset4(offset: number, offset2: number, offset3: number, offset4: number, offset5: number): number {
    return offset + offset2 + offset3 + offset4 + offset5;
}

export function getOffsetFromOffset5(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6;
}

export function getOffsetFromOffset6(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7;
}

export function getOffsetFromOffset7(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8;
}

export function getOffsetFromOffset8(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9;
}

export function getOffsetFromOffset9(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10;
}

export function getOffsetFromOffset10(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11;
}

export function getOffsetFromOffset11(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12;
}

export function getOffsetFromOffset12(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13;
}

export function getOffsetFromOffset13(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14;
}

export function getOffsetFromOffset14(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15;
}

export function getOffsetFromOffset15(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16;
}

export function getOffsetFromOffset16(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17;
}

export function getOffsetFromOffset17(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18;
}

export function getOffsetFromOffset18(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19;
}

export function getOffsetFromOffset19(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20;
}

export function getOffsetFromOffset20(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21;
}

export function getOffsetFromOffset21(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22;
}

export function getOffsetFromOffset22(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23;
}

export function getOffsetFromOffset23(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24;
}

export function getOffsetFromOffset24(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25;
}

export function getOffsetFromOffset25(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26;
}

export function getOffsetFromOffset26(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27;
}

export function getOffsetFromOffset27(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28;
}

export function getOffsetFromOffset28(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29;
}

export function getOffsetFromOffset29(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30;
}

export function getOffsetFromOffset30(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31;
}

export function getOffsetFromOffset31(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32;
}

export function getOffsetFromOffset32(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33;
}

export function getOffsetFromOffset33(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34;
}

export function getOffsetFromOffset34(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35;
}

export function getOffsetFromOffset35(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36;
}

export function getOffsetFromOffset36(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37;
}

export function getOffsetFromOffset37(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38;
}

export function getOffsetFromOffset38(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39;
}

export function getOffsetFromOffset39(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40;
}

export function getOffsetFromOffset40(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41;
}

export function getOffsetFromOffset41(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42;
}

export function getOffsetFromOffset42(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43;
}

export function getOffsetFromOffset43(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44;
}

export function getOffsetFromOffset44(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45;
}

export function getOffsetFromOffset45(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46;
}

export function getOffsetFromOffset46(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number, offset47: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46 + offset47;
}

export function getOffsetFromOffset47(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number, offset47: number, offset48: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46 + offset47 + offset48;
}

export function getOffsetFromOffset48(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number, offset47: number, offset48: number, offset49: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46 + offset47 + offset48 + offset49;
}

export function getOffsetFromOffset49(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number, offset47: number, offset48: number, offset49: number, offset50: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46 + offset47 + offset48 + offset49 + offset50;
}

export function getOffsetFromOffset50(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number, offset47: number, offset48: number, offset49: number, offset50: number, offset51: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46 + offset47 + offset48 + offset49 + offset50 + offset51;
}
