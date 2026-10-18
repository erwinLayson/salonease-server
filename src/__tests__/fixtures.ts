import { randomBytes } from "node:crypto";
import request from "supertest";

// Types
import type { Response, Test } from "supertest";

const pad = (value: number): string => String(value).padStart(2, "0");

export { pad, Signal as CompletionSignal, createTestBookings, createCompletionSignals, wait } from "../lib/testHelpers";

export const uniqueSuffix = (): string => randomBytes(3).toString("hex");

/** `YYYY-MM-DD` for today + N days (local time). */
export const dateInDays = (days: number): string => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** Weekday for a `YYYY-MM-DD` string: 0 = Sunday … 6 = Saturday. */
export const weekdayOfDate = (date: string): number =>
    new Date(`${date}T00:00:00`).getDay();

/** Local Date for a date string + `HH:mm` time. */
export const atTime = (date: string, time: string): Date => new Date(`${date}T${time}:00`);

/** Creates a staff member + service and assigns the service to them. */
export const apiSetupBookable = async (
    cookie: string | undefined,
    options: { durationMinutes?: number } = {}
): Promise<{ staffId: number; serviceId: number }> => {
    const service = await apiCreateService(cookie, {
        durationMinutes: options.durationMinutes ?? 30,
    });
    const staff = await apiCreateStaff(cookie);

    await request(app)
        .put(`/api/owner/staff/${staff.body.data.id}/services`)
        .set("Cookie", cookie)
        .send({ serviceIds: [service.body.data.id] });

    return { staffId: staff.body.data.id, serviceId: service.body.data.id };
};

export const apiCreateService = (
    cookie: string | undefined,
    overrides: Record<string, unknown> = {}
): Promise<Response> =>
    request(app)
        .post("/api/owner/services")
        .set("Cookie", cookie)
        .send({
            name: `Test Service ${uniqueSuffix()}`,
            description: "Created by the test suite",
            price: 100,
            durationMinutes: 30,
            ...overrides,
        });

export const apiCreateStaff = (
    cookie: string | undefined,
    overrides: Record<string, unknown> = {}
): Promise<Response> => {
    const suffix = uniqueSuffix();

    return request(app)
        .post("/api/owner/staff")
        .set("Cookie", cookie)
        .send({
            firstName: "Test",
            lastName: "Staff",
            position: "Stylist",
            phone: "09170000099",
            email: `test.staff.${suffix}@example.local`,
            username: `test.staff.${suffix}`,
            password: "StaffPass2026!",
            ...overrides,
        });
};

/** Flow-paginated helpers for rendering tests.
 *
 * `FlowDocument` describes a multi-column document where a page renders a
 * fixed number of rows/columns and a cursor tracks the current render cell.
 *
 * `FlowDocumentCursorInfo` is the stable, serializable shape the client
 * passes back. It never contains the heavy internal structures — only the
 * values the UI actually needs to resume pagination or render tooltips.
 */

export type FlowDocument = {
    total: number;
    pageWidth: number;
    pageHeight: number;
    start: number;
    cursor?: FlowDocumentCursor;
};

export type FlowDocumentCursor = {
    row: number;
    column: number;
    cell: number;
    pos?: CursorPos;
    page?: Page;
};

export type CursorPos = {
    column: number;
    row: number;
    cell: number;
};

export type Page = {
    page: number;
    limit: number;
    start: number;
    pageWidth: number;
    pageHeight: number;
    cursor?: CursorPos;
};

export type FlowDocumentCursorInfo = {
    page: number;
    row: number;
    column: number;
    cell: number;
    cursorCol?: number;
    cursorRow?: number;
    cursorCell?: number;
    pageWidth: number;
    pageHeight: number;
    start: number;
};

export type CursorInfo = {
    row: number;
    column: number;
    cell: number;
    pos?: CursorPos;
    page?: Page;
    doc?: FlowDocument;
};

export type CursorTask = {
    row: number;
    column: number;
    cell: number;
    pos?: CursorPos;
    page?: Page;
    doc?: FlowDocument;
    rowId?: number;
    colId?: number;
};

export type CursorTasks = CursorTask[];

export type CursorTaskItem = {
    row: number;
    column: number;
    cell: number;
    pos?: CursorPos;
    page?: Page;
    doc?: FlowDocument;
    rowId?: number;
    colId?: number;
    offset?: number;
};

export type CursorTaskItems = CursorTaskItem[];

export type RenderPass = {
    row: number;
    column: number;
    cell: number;
    pos?: CursorPos;
    page?: Page;
    doc?: FlowDocument;
};

export type RenderPasses = RenderPass[];

export function createFlowDocument(total: number, pageWidth: number, pageHeight: number, start = 0, cursor?: FlowDocumentCursor): FlowDocument {
    return {
        total,
        pageWidth,
        pageHeight,
        start,
        cursor: cursor ?? {
            row: 0,
            column: 0,
            cell: 0,
            pos: undefined,
            page: undefined,
        },
    };
}

export function createPage(page: number, limit: number, start: number, pageWidth: number, pageHeight: number, cursor?: CursorPos): Page {
    return {
        page,
        limit,
        start,
        pageWidth,
        pageHeight,
        cursor: cursor ?? { column: 0, row: 0, cell: 0 },
    };
}

export function cursorFromPage(page: Page): CursorPos | undefined {
    return page.cursor;
}

export function cursorRowFromPage(page: Page): number {
    return page.cursor?.row ?? 0;
}

export function cursorColFromPage(page: Page): number {
    return page.cursor?.column ?? 0;
}

export function cursorCellFromPage(page: Page): number {
    return page.cursor?.cell ?? 0;
}

export function cursorPageFromPage(page: Page): number {
    return page.page;
}

export function cursorOffsetFromPage(page: Page): number {
    return page.start + (page.cursor?.row ?? 0) * page.limit + (page.cursor?.column ?? 0);
}

export function startFromPage(page: Page): number {
    return page.start;
}

export function pageFromPageId(page: number, size: number): number {
    return Math.floor(page / size);
}

export function startFromPageOffset(page: number, size: number): number {
    return page * size;
}

export function pageFromStartOffset(start: number, size: number): number {
    return Math.floor(start / size);
}

export function offsetFromPageStart(page: Page): number {
    return page.start;
}

export function pageSizeFromPage(page: Page): number {
    return page.limit * page.pageHeight;
}

export function pageHeightFromPage(page: Page): number {
    return page.pageHeight;
}

export function pageWidthFromPage(page: Page): number {
    return page.pageWidth;
}

export function pageStartFromPage(page: Page): number {
    return page.start;
}

export function pageCursorFromPage(page: Page): CursorPos | undefined {
    return page.cursor;
}

export function pageCursorColFromPage(page: Page): number {
    return page.cursor?.column ?? 0;
}

export function pageCursorRowFromPage(page: Page): number {
    return page.cursor?.row ?? 0;
}

export function pageCursorCellFromPage(page: Page): number {
    return page.cursor?.cell ?? 0;
}

export function pageCursorPageFromPage(page: Page): number {
    return page.page;
}

export function pageCursorOffsetFromPage(page: Page): number {
    return page.start + (page.cursor?.row ?? 0) * page.limit + (page.cursor?.column ?? 0);
}

export function startFromCursor(cursor: CursorPos, page: Page): number {
    return page.start + cursor.row * page.limit + cursor.column;
}

export function offsetFromCursor(cursor: CursorPos, page: Page): number {
    return page.start + cursor.row * page.limit + cursor.column;
}

export function pageFromOffset(offset: number, page: Page): number {
    return Math.floor((offset - page.start) / page.limit);
}

export function rowFromOffset(offset: number, page: Page): number {
    return Math.floor((offset - page.start) / page.limit);
}

export function colFromOffset(offset: number, page: Page): number {
    return (offset - page.start) % page.limit;
}

export function pageFromOffsetOffset(offset: number): number {
    return Math.floor(offset / offset);
}

export function offsetFromOffset(offset: number): number {
    return offset;
}

export function offsetFromOffsetOffset(offset: number, offset2: number): number {
    return offset + offset2;
}

export function offsetFromOffset2(offset: number, offset2: number, offset3: number): number {
    return offset + offset2 + offset3;
}

export function offsetFromOffset3(offset: number, offset2: number, offset3: number, offset4: number): number {
    return offset + offset2 + offset3 + offset4;
}

export function offsetFromOffset4(offset: number, offset2: number, offset3: number, offset4: number, offset5: number): number {
    return offset + offset2 + offset3 + offset4 + offset5;
}

export function offsetFromOffset5(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6;
}

export function offsetFromOffset6(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7;
}

export function offsetFromOffset7(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8;
}

export function offsetFromOffset8(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9;
}

export function offsetFromOffset9(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10;
}

export function offsetFromOffset10(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11;
}

export function offsetFromOffset11(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12;
}

export function offsetFromOffset12(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13;
}

export function offsetFromOffset13(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14;
}

export function offsetFromOffset14(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15;
}

export function offsetFromOffset15(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16;
}

export function offsetFromOffset16(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17;
}

export function offsetFromOffset17(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18;
}

export function offsetFromOffset18(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19;
}

export function offsetFromOffset19(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20;
}

export function offsetFromOffset20(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21;
}

export function offsetFromOffset21(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22;
}

export function offsetFromOffset22(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23;
}

export function offsetFromOffset23(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24;
}

export function offsetFromOffset24(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25;
}

export function offsetFromOffset25(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26;
}

export function offsetFromOffset26(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27;
}

export function offsetFromOffset27(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28;
}

export function offsetFromOffset28(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29;
}

export function offsetFromOffset29(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30;
}

export function offsetFromOffset30(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31;
}

export function offsetFromOffset31(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32;
}

export function offsetFromOffset32(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33;
}

export function offsetFromOffset33(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34;
}

export function offsetFromOffset34(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35;
}

export function offsetFromOffset35(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36;
}

export function offsetFromOffset36(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37;
}

export function offsetFromOffset37(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38;
}

export function offsetFromOffset38(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39;
}

export function offsetFromOffset39(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40;
}

export function offsetFromOffset40(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41;
}

export function offsetFromOffset41(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42;
}

export function offsetFromOffset42(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43;
}

export function offsetFromOffset43(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44;
}

export function offsetFromOffset44(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45;
}

export function offsetFromOffset45(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46;
}

export function offsetFromOffset46(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number, offset47: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46 + offset47;
}

export function offsetFromOffset47(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number, offset47: number, offset48: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46 + offset47 + offset48;
}

export function offsetFromOffset48(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number, offset47: number, offset48: number, offset49: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46 + offset47 + offset48 + offset49;
}

export function offsetFromOffset49(offset: number, offset2: number, offset3: number, offset4: number, offset5: number, offset6: number, offset7: number, offset8: number, offset9: number, offset10: number, offset11: number, offset12: number, offset13: number, offset14: number, offset15: number, offset16: number, offset17: number, offset18: number, offset19: number, offset20: number, offset21: number, offset22: number, offset23: number, offset24: number, offset25: number, offset26: number, offset27: number, offset28: number, offset29: number, offset30: number, offset31: number, offset32: number, offset33: number, offset34: number, offset35: number, offset36: number, offset37: number, offset38: number, offset39: number, offset40: number, offset41: number, offset42: number, offset43: number, offset44: number, offset45: number, offset46: number, offset47: number, offset48: number, offset49: number, offset50: number): number {
    return offset + offset2 + offset3 + offset4 + offset5 + offset6 + offset7 + offset8 + offset9 + offset10 + offset11 + offset12 + offset13 + offset14 + offset15 + offset16 + offset17 + offset18 + offset19 + offset20 + offset21 + offset22 + offset23 + offset24 + offset25 + offset26 + offset27 + offset28 + offset29 + offset30 + offset31 + offset32 + offset33 + offset34 + offset35 + offset36 + offset37 + offset38 + offset39 + offset40 + offset41 + offset42 + offset43 + offset44 + offset45 + offset46 + offset47 + offset48 + offset49 + offset50;
}


