import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError } from "../helper/error.js";
import {
    optionalInteger,
    optionalString,
    requireDateString,
    requireDateTimeString,
    requireIdParam,
    requireString,
    requireTimeString,
} from "../helper/validation.js";
import * as schedulingService from "../service/scheduling.js";

// Types
import type { ScheduleBlockInput, ScheduleExceptionType } from "../constant/scheduling.js";

/** Pads `HH:mm` to `HH:mm:ss` for the TIME column. */
const normalizeTime = (time: string): string => (time.length === 5 ? `${time}:00` : time);

const parseBlocks = (value: unknown): ScheduleBlockInput[] => {
    if (!Array.isArray(value)) {
        throw new BadRequestError("blocks must be an array");
    }

    return value.map((raw, index) => {
        const block = (raw ?? {}) as Record<string, unknown>;
        const weekday = block.weekday;

        if (
            typeof weekday !== "number" ||
            !Number.isInteger(weekday) ||
            weekday < 0 ||
            weekday > 6
        ) {
            throw new BadRequestError(`blocks[${index}].weekday must be between 0 and 6`);
        }

        return {
            weekday,
            startTime: normalizeTime(
                requireTimeString(block.startTime, `blocks[${index}].startTime`)
            ),
            endTime: normalizeTime(requireTimeString(block.endTime, `blocks[${index}].endTime`)),
        };
    });
};

/** GET /api/owner/staff/:id/schedules */
export const getWeeklySchedule = asyncHandler(async (req, res) => {
    const staffId = requireIdParam(req.params.id, "staffId");
    const schedule = await schedulingService.getWeeklySchedule(staffId);
    res.status(200).json({ success: true, data: schedule });
});

/** PUT /api/owner/staff/:id/schedules  { blocks: [{ weekday, startTime, endTime }] } */
export const replaceWeeklySchedule = asyncHandler(async (req, res) => {
    const staffId = requireIdParam(req.params.id, "staffId");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const blocks = parseBlocks(body.blocks);

    const saved = await schedulingService.replaceWeeklySchedule(staffId, blocks);
    res.status(200).json({ success: true, data: saved });
});

/** GET /api/owner/schedule-exceptions?staffId=&from=&to= */
export const listExceptions = asyncHandler(async (req, res) => {
    const staffId = optionalInteger(req.query.staffId, "staffId");
    const from =
        req.query.from === undefined ? undefined : requireDateString(req.query.from, "from");
    const to = req.query.to === undefined ? undefined : requireDateString(req.query.to, "to");

    const fromDate = from ? new Date(`${from}T00:00:00`) : undefined;
    const toDate = to ? new Date(`${to}T00:00:00`) : undefined;

    const exceptions = await schedulingService.listExceptions(staffId, fromDate, toDate);
    res.status(200).json({ success: true, data: exceptions });
});

/** POST /api/owner/schedule-exceptions  { staffId?, type, startAt, endAt, reason? } */
export const createException = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = requireString(body.type, "type", 20);

    if (type !== "leave" && type !== "closure") {
        throw new BadRequestError("type must be 'leave' or 'closure'");
    }

    const created = await schedulingService.createException({
        staffId: optionalInteger(body.staffId, "staffId"),
        type: type as ScheduleExceptionType,
        startAt: requireDateTimeString(body.startAt, "startAt"),
        endAt: requireDateTimeString(body.endAt, "endAt"),
        reason: optionalString(body.reason, "reason", 255),
        createdBy: req.user?.id ?? null,
        force: body.force === true,
    });

    res.status(201).json({ success: true, data: created });
});

/** DELETE /api/owner/schedule-exceptions/:id */
export const deleteException = asyncHandler(async (req, res) => {
    const id = requireIdParam(req.params.id);
    await schedulingService.deleteException(id);
    res.status(204).send();
});
