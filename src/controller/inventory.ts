import { asyncHandler } from "../helper/asyncHandler.js";
import { BadRequestError, UnauthorizedError } from "../helper/error.js";
import {
    optionalString,
    requireDateString,
    requireIdParam,
    requireNumber,
    requireString,
} from "../helper/validation.js";
import { combineDateTime, endOfDay } from "../helper/time.js";
import {
    ALERT_STATUSES,
    MANUAL_MOVEMENT_TYPES,
    SUPPLY_CATEGORIES,
} from "../constant/inventory.js";
import * as inventoryService from "../service/inventory.js";

// Types
import type { Request } from "express";
import type {
    AlertStatus,
    ManualMovementType,
    SupplyCategory,
} from "../constant/inventory.js";

const present = (value: unknown): boolean =>
    value !== undefined && value !== null && value !== "";

const parseSupplyBody = (body: unknown): inventoryService.SupplyInput => {
    const input = (body ?? {}) as Record<string, unknown>;

    const rawCategory = requireString(input.category ?? "other", "category", 20);
    if (!SUPPLY_CATEGORIES.includes(rawCategory as SupplyCategory)) {
        throw new BadRequestError(
            `category must be one of: ${SUPPLY_CATEGORIES.join(", ")}`
        );
    }

    const reorderLevel = requireNumber(input.reorderLevel ?? 0, "reorderLevel");
    if (reorderLevel < 0) throw new BadRequestError("reorderLevel must be 0 or more");

    const unitCost = present(input.unitCost)
        ? requireNumber(input.unitCost, "unitCost")
        : null;
    if (unitCost !== null && unitCost < 0) {
        throw new BadRequestError("unitCost must be 0 or more");
    }

    const currentQuantity = present(input.currentQuantity)
        ? requireNumber(input.currentQuantity, "currentQuantity")
        : present(input.initialQuantity)
          ? requireNumber(input.initialQuantity, "initialQuantity")
          : undefined;
    if (currentQuantity !== undefined && currentQuantity < 0) {
        throw new BadRequestError("Current quantity must be 0 or more");
    }

    return {
        sku: requireString(input.sku, "sku", 60),
        name: requireString(input.name, "name", 160),
        category: rawCategory as SupplyCategory,
        unit: requireString(input.unit, "unit", 20),
        currentQuantity,
        reorderLevel,
        unitCost,
        supplier: optionalString(input.supplier, "supplier", 160),
        notes: optionalString(input.notes, "notes", 255),
    };
};

const parseRange = (req: Request): { from: Date; to: Date } => {
    const from = present(req.query.from)
        ? combineDateTime(requireDateString(req.query.from, "from"), "00:00:00")
        : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const to = present(req.query.to)
        ? endOfDay(combineDateTime(requireDateString(req.query.to, "to"), "00:00:00"))
        : endOfDay(new Date());
    return { from, to };
};

/** GET /api/owner/supplies?includeInactive=true */
export const listSupplies = asyncHandler(async (req, res) => {
    const data = await inventoryService.listSupplies(req.query.includeInactive === "true");
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/supplies/:id */
export const getSupply = asyncHandler(async (req, res) => {
    const data = await inventoryService.getSupply(requireIdParam(req.params.id));
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/supplies */
export const createSupply = asyncHandler(async (req, res) => {
    const data = await inventoryService.createSupply(
        parseSupplyBody(req.body),
        req.user?.id ?? null
    );
    res.status(201).json({ success: true, data });
});

/** PUT /api/owner/supplies/:id */
export const updateSupply = asyncHandler(async (req, res) => {
    const data = await inventoryService.updateSupply(
        requireIdParam(req.params.id),
        parseSupplyBody(req.body),
        req.user?.id ?? null
    );
    res.status(200).json({ success: true, data });
});

/** PATCH /api/owner/supplies/:id/status { isActive } */
export const setSupplyStatus = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.isActive !== "boolean") {
        throw new BadRequestError("isActive must be true or false");
    }
    const data = await inventoryService.setSupplyActive(
        requireIdParam(req.params.id),
        body.isActive
    );
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/supplies/:id/movements */
export const listMovements = asyncHandler(async (req, res) => {
    const data = await inventoryService.listMovements(requireIdParam(req.params.id));
    res.status(200).json({ success: true, data });
});

/** POST /api/owner/supplies/:id/movements */
export const createMovement = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const rawType = requireString(body.movementType, "movementType", 20);
    if (!MANUAL_MOVEMENT_TYPES.includes(rawType as ManualMovementType)) {
        throw new BadRequestError(
            `movementType must be one of: ${MANUAL_MOVEMENT_TYPES.join(", ")}`
        );
    }

    const quantity = requireNumber(body.quantity, "quantity");
    if (quantity === 0) throw new BadRequestError("quantity must not be zero");
    if (rawType !== "adjustment" && quantity < 0) {
        throw new BadRequestError("quantity must be positive for this movement type");
    }

    const unitCost = present(body.unitCost)
        ? requireNumber(body.unitCost, "unitCost")
        : null;

    const data = await inventoryService.adjustStock(requireIdParam(req.params.id), {
        movementType: rawType as ManualMovementType,
        quantity,
        unitCost,
        notes: optionalString(body.notes, "notes", 255),
        createdBy: req.user.id,
    });
    res.status(201).json({ success: true, data });
});

/** GET /api/owner/inventory/recipes */
export const listAllRecipes = asyncHandler(async (_req, res) => {
    const data = await inventoryService.listAllRecipes();
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/services/:id/supplies */
export const getRecipe = asyncHandler(async (req, res) => {
    const data = await inventoryService.getRecipe(requireIdParam(req.params.id));
    res.status(200).json({ success: true, data });
});

/** PUT /api/owner/services/:id/supplies */
export const replaceRecipe = asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!Array.isArray(body.items)) {
        throw new BadRequestError("items must be an array");
    }

    const items = body.items.map((raw, index) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        return {
            supplyId: requireIdParam(String(item.supplyId ?? ""), `items[${index}].supplyId`),
            quantityPerService: requireNumber(
                item.quantityPerService,
                `items[${index}].quantityPerService`
            ),
            unit: requireString(item.unit, `items[${index}].unit`, 20),
        };
    });

    const data = await inventoryService.replaceRecipe(
        requireIdParam(req.params.id),
        items
    );
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/inventory/alerts?status=open */
export const listAlerts = asyncHandler(async (req, res) => {
    let status: AlertStatus | null = null;
    if (present(req.query.status)) {
        const raw = requireString(req.query.status, "status", 20);
        if (!ALERT_STATUSES.includes(raw as AlertStatus)) {
            throw new BadRequestError(
                `status must be one of: ${ALERT_STATUSES.join(", ")}`
            );
        }
        status = raw as AlertStatus;
    }
    const data = await inventoryService.listAlerts(status);
    res.status(200).json({ success: true, data });
});

/** PATCH /api/owner/inventory/alerts/:id/acknowledge */
export const acknowledgeAlert = asyncHandler(async (req, res) => {
    if (!req.user) throw new UnauthorizedError("Authentication required");
    await inventoryService.acknowledgeAlert(
        requireIdParam(req.params.id),
        req.user.id
    );
    res.status(200).json({ success: true });
});

/** PATCH /api/owner/inventory/alerts/:id/resolve */
export const resolveAlert = asyncHandler(async (req, res) => {
    await inventoryService.resolveAlert(requireIdParam(req.params.id));
    res.status(200).json({ success: true });
});

/** GET /api/owner/inventory/summary */
export const summary = asyncHandler(async (_req, res) => {
    const data = await inventoryService.getInventorySummary();
    res.status(200).json({ success: true, data });
});

/** GET /api/owner/reports/inventory?from=&to= */
export const usageReport = asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req);
    const data = await inventoryService.getUsageReport(from, to);
    res.status(200).json({ success: true, data });
});
