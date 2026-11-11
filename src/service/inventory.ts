import type { PoolConnection } from "mysql2/promise";
import InventoryModel from "../model/inventory.js";
import ServiceModel from "../model/services.js";
import { withConnection, withTransaction } from "../helper/withConnection.js";
import { ConflictError, NotFoundError } from "../helper/error.js";
import { notifyRole } from "./notifications.js";

// Types
import type {
    AlertStatus,
    ManualMovementType,
    SupplyCategory,
} from "../constant/inventory.js";
import type {
    InventoryAlertRow,
    MovementRow,
    RecipeRow,
    SupplyRow,
} from "../model/inventory.js";

export interface SupplyDetail {
    id: number;
    sku: string;
    name: string;
    category: SupplyCategory;
    unit: string;
    currentQuantity: number;
    reorderLevel: number;
    unitCost: number | null;
    supplier: string | null;
    notes: string | null;
    isActive: boolean;
    lowStock: boolean;
}

export interface MovementDetail {
    id: number;
    supplyId: number;
    supplyName: string;
    movementType: string;
    quantityDelta: number;
    balanceAfter: number;
    unitCost: number | null;
    referenceType: string | null;
    referenceId: number | null;
    notes: string | null;
    createdAt: Date;
}

export interface RecipeDetail {
    supplyId: number;
    supplyName: string;
    unit: string;
    quantityPerService: number;
}

export interface AlertDetail {
    id: number;
    supplyId: number;
    supplyName: string;
    alertType: "low_stock" | "out_of_stock";
    status: AlertStatus;
    currentQuantity: number;
    reorderLevel: number;
    acknowledgedAt: Date | null;
    resolvedAt: Date | null;
    createdAt: Date;
}

const toSupply = (row: SupplyRow): SupplyDetail => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category,
    unit: row.unit,
    currentQuantity: Number(row.current_quantity),
    reorderLevel: Number(row.reorder_level),
    unitCost: row.unit_cost === null ? null : Number(row.unit_cost),
    supplier: row.supplier,
    notes: row.notes,
    isActive: row.is_active === 1,
    lowStock: Number(row.is_low_stock) === 1,
});

const toMovement = (row: MovementRow): MovementDetail => ({
    id: row.id,
    supplyId: row.supply_id,
    supplyName: row.supply_name,
    movementType: row.movement_type,
    quantityDelta: Number(row.quantity_delta),
    balanceAfter: Number(row.balance_after),
    unitCost: row.unit_cost === null ? null : Number(row.unit_cost),
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    notes: row.notes,
    createdAt: row.created_at,
});

const toRecipe = (row: RecipeRow): RecipeDetail => ({
    supplyId: row.supply_id,
    supplyName: row.supply_name,
    unit: row.unit,
    quantityPerService: Number(row.quantity_per_service),
});

const toAlert = (row: InventoryAlertRow): AlertDetail => ({
    id: row.id,
    supplyId: row.supply_id,
    supplyName: row.supply_name,
    alertType: row.alert_type,
    status: row.status,
    currentQuantity: Number(row.current_quantity),
    reorderLevel: Number(row.reorder_level),
    acknowledgedAt: row.acknowledged_at,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
});

export interface SupplyInput {
    sku: string;
    name: string;
    category: SupplyCategory;
    unit: string;
    currentQuantity?: number | undefined;
    reorderLevel: number;
    unitCost: number | null;
    supplier: string | null;
    notes: string | null;
}

export const listSupplies = (includeInactive: boolean): Promise<SupplyDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new InventoryModel(connection).listSupplies(includeInactive);
        return rows.map(toSupply);
    });

export const getSupply = (id: number): Promise<SupplyDetail> =>
    withConnection(async (connection) => {
        const row = await new InventoryModel(connection).findSupplyById(id);
        if (!row) throw new NotFoundError("Supply not found", 404);
        return toSupply(row);
    });

export const createSupply = (
    input: SupplyInput,
    userId: number | null = null
): Promise<SupplyDetail> =>
    withTransaction(async (connection) => {
        const model = new InventoryModel(connection);
        if (await model.findSupplyBySku(input.sku)) {
            throw new ConflictError("A supply with this SKU already exists");
        }
        const initialQty = input.currentQuantity ?? 0;
        const id = await model.createSupply({
            ...input,
            currentQuantity: initialQty,
        });

        if (initialQty > 0) {
            await model.insertMovement({
                supplyId: id,
                movementType: "initial",
                quantityDelta: initialQty,
                balanceAfter: initialQty,
                unitCost: input.unitCost,
                referenceType: "manual",
                referenceId: null,
                notes: "Initial stock on supply creation",
                createdBy: userId,
            });
        }

        await evaluateAlert(connection, id, userId);
        return toSupply((await model.findSupplyById(id))!);
    });

export const updateSupply = (
    id: number,
    input: SupplyInput,
    userId: number | null = null
): Promise<SupplyDetail> =>
    withTransaction(async (connection) => {
        const model = new InventoryModel(connection);
        const existing = await model.findSupplyById(id);
        if (!existing) throw new NotFoundError("Supply not found", 404);

        const clash = await model.findSupplyBySku(input.sku);
        if (clash && clash.id !== id) {
            throw new ConflictError("A supply with this SKU already exists");
        }

        await model.updateSupply(id, input);

        if (
            input.currentQuantity !== undefined &&
            input.currentQuantity !== Number(existing.current_quantity)
        ) {
            const oldQty = Number(existing.current_quantity);
            const newQty = input.currentQuantity;
            const delta = newQty - oldQty;
            await model.updateQuantity(id, newQty);
            await model.insertMovement({
                supplyId: id,
                movementType: "adjustment",
                quantityDelta: delta,
                balanceAfter: newQty,
                unitCost: input.unitCost ?? existing.unit_cost,
                referenceType: "manual",
                referenceId: null,
                notes: `Stock adjusted in supply details (${oldQty} -> ${newQty})`,
                createdBy: userId,
            });
        }

        await evaluateAlert(connection, id, userId);
        return toSupply((await model.findSupplyById(id))!);
    });

export const setSupplyActive = (id: number, isActive: boolean): Promise<SupplyDetail> =>
    withTransaction(async (connection) => {
        const model = new InventoryModel(connection);
        if (!(await model.findSupplyById(id))) {
            throw new NotFoundError("Supply not found", 404);
        }
        await model.setSupplyActive(id, isActive);
        return toSupply((await model.findSupplyById(id))!);
    });

export interface ManualMovementInput {
    movementType: ManualMovementType;
    quantity: number;
    unitCost: number | null;
    notes: string | null;
    createdBy: number | null;
}

/** Records a manual stock movement and keeps the current balance in sync. */
export const adjustStock = (
    supplyId: number,
    input: ManualMovementInput
): Promise<SupplyDetail> =>
    withTransaction(async (connection) => {
        const model = new InventoryModel(connection);
        const supply = await model.lockSupplyRow(supplyId);
        if (!supply) throw new NotFoundError("Supply not found", 404);

        const magnitude = Math.abs(input.quantity);
        if (magnitude <= 0) {
            throw new ConflictError("Quantity must be greater than zero.");
        }

        const signedDelta =
            input.movementType === "waste"
                ? -magnitude
                : input.movementType === "adjustment"
                  ? input.quantity
                  : magnitude;

        const next = Number(supply.current_quantity) + signedDelta;
        if (next < 0) {
            throw new ConflictError(
                `Not enough stock. ${supply.name} has ${supply.current_quantity} ${supply.unit} available.`
            );
        }

        await model.updateQuantity(supplyId, next);
        await model.insertMovement({
            supplyId,
            movementType: input.movementType,
            quantityDelta: signedDelta,
            balanceAfter: next,
            unitCost: input.unitCost ?? supply.unit_cost,
            referenceType: "manual",
            referenceId: null,
            notes: input.notes,
            createdBy: input.createdBy,
        });

        await evaluateAlert(connection, supplyId, input.createdBy);
        return toSupply((await model.findSupplyById(supplyId))!);
    });

export const listMovements = (supplyId: number): Promise<MovementDetail[]> =>
    withConnection(async (connection) => {
        const model = new InventoryModel(connection);
        if (!(await model.findSupplyById(supplyId))) {
            throw new NotFoundError("Supply not found", 404);
        }
        const rows = await model.listMovements(supplyId);
        return rows.map(toMovement);
    });

export const getRecipe = (serviceId: number): Promise<RecipeDetail[]> =>
    withConnection(async (connection) => {
        const service = await new ServiceModel(connection).findById(serviceId);
        if (!service) throw new NotFoundError("Service not found", 404);
        const rows = await new InventoryModel(connection).listRecipes(serviceId);
        return rows.map(toRecipe);
    });

export interface AllRecipeDetail extends RecipeDetail {
    serviceId: number;
}

export const listAllRecipes = (): Promise<AllRecipeDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new InventoryModel(connection).listAllRecipes();
        return rows.map((r) => ({
            ...toRecipe(r),
            serviceId: r.service_id,
        }));
    });

export interface RecipeInput {
    supplyId: number;
    quantityPerService: number;
    unit: string;
}

export const replaceRecipe = async (
    serviceId: number,
    items: RecipeInput[]
): Promise<RecipeDetail[]> => {
    await withTransaction(async (connection) => {
        const service = await new ServiceModel(connection).findById(serviceId);
        if (!service) throw new NotFoundError("Service not found", 404);

        const model = new InventoryModel(connection);
        const seen = new Set<number>();

        for (const item of items) {
            if (seen.has(item.supplyId)) {
                throw new ConflictError("A supply can only appear once in a recipe.");
            }
            seen.add(item.supplyId);

            if (item.quantityPerService <= 0) {
                throw new ConflictError("Recipe quantities must be greater than zero.");
            }

            const supply = await model.findSupplyById(item.supplyId);
            if (!supply) throw new NotFoundError("Supply not found", 404);
            if (supply.unit.toLowerCase() !== item.unit.trim().toLowerCase()) {
                throw new ConflictError(
                    `Unit for ${supply.name} must be ${supply.unit}.`
                );
            }
        }

        await model.replaceRecipes(serviceId, items);
    });

    return getRecipe(serviceId);
};

export const listAlerts = (status: AlertStatus | null): Promise<AlertDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new InventoryModel(connection).listAlerts(status);
        return rows.map(toAlert);
    });

export const acknowledgeAlert = (id: number, userId: number): Promise<void> =>
    withConnection((connection) =>
        new InventoryModel(connection).acknowledgeAlert(id, userId)
    );

export const resolveAlert = (id: number): Promise<void> =>
    withConnection((connection) => new InventoryModel(connection).resolveAlert(id));

/**
 * Creates a low-stock/out-of-stock alert if none is open and notifies owners.
 * Safe to call inside a transaction.
 */
export const evaluateAlert = async (
    connection: PoolConnection,
    supplyId: number,
    actorId: number | null
): Promise<void> => {
    const model = new InventoryModel(connection);
    const supply = await model.findSupplyById(supplyId);
    if (!supply || supply.is_active !== 1) return;

    const quantity = Number(supply.current_quantity);
    const reorder = Number(supply.reorder_level);
    if (quantity > reorder) return;

    const existing = await model.findOpenAlert(supplyId);
    if (existing) return;

    const alertType = quantity <= 0 ? "out_of_stock" : "low_stock";
    const id = await model.createAlert({
        supplyId,
        alertType,
        currentQuantity: quantity,
        reorderLevel: reorder,
    });
    if (id === null) return;

    await notifyRole(
        "owner",
        {
            type: "low_stock",
            severity: quantity <= 0 ? "critical" : "warning",
            title: quantity <= 0 ? `Out of stock: ${supply.name}` : `Low stock: ${supply.name}`,
            body: `${supply.name} has ${quantity} ${supply.unit} left (reorder at ${reorder}).`,
            link: "/owner/inventory",
        },
        connection
    );

    void actorId;
};

export interface DeductionResult {
    supplyId: number;
    supplyName: string;
    quantity: number;
    balanceAfter: number;
}

/**
 * Deducts a service recipe from stock. Must run inside the appointment
 * completion transaction. Idempotent per appointment + supply.
 */
export const deductForAppointment = async (
    connection: PoolConnection,
    opts: { appointmentId: number; serviceId: number; createdBy: number | null }
): Promise<DeductionResult[]> => {
    const model = new InventoryModel(connection);
    const recipes = (await model.listRecipes(opts.serviceId)).sort(
        (a, b) => a.supply_id - b.supply_id
    );

    const results: DeductionResult[] = [];

    for (const recipe of recipes) {
        const already = await model.findAutomaticMovement(
            "appointment",
            opts.appointmentId,
            recipe.supply_id,
            "usage"
        );
        if (already) {
            results.push({
                supplyId: recipe.supply_id,
                supplyName: recipe.supply_name,
                quantity: Math.abs(Number(already.quantity_delta)),
                balanceAfter: Number(already.balance_after),
            });
            continue;
        }

        const supply = await model.lockSupplyRow(recipe.supply_id);
        if (!supply || supply.is_active !== 1) continue;

        const quantity = Number(recipe.quantity_per_service);
        const before = Number(supply.current_quantity);
        if (before < quantity) {
            throw new ConflictError(
                `Not enough ${supply.name} in stock. Needed ${quantity} ${supply.unit}, available ${before}.`
            );
        }

        const after = before - quantity;
        await model.updateQuantity(supply.id, after);
        await model.insertMovement({
            supplyId: supply.id,
            movementType: "usage",
            quantityDelta: -quantity,
            balanceAfter: after,
            unitCost: supply.unit_cost,
            referenceType: "appointment",
            referenceId: opts.appointmentId,
            notes: `Consumed by service #${opts.serviceId}`,
            createdBy: opts.createdBy,
        });

        await evaluateAlert(connection, supply.id, opts.createdBy);

        results.push({
            supplyId: supply.id,
            supplyName: supply.name,
            quantity,
            balanceAfter: after,
        });
    }

    return results;
};

/**
 * Deducts service recipes from stock for all services included in an event.
 * Must run inside the event completion transaction. Idempotent per event + supply.
 */
export const deductForEvent = async (
    connection: PoolConnection,
    opts: {
        eventId: number;
        services: Array<{ serviceId: number; quantity: number }>;
        createdBy: number | null;
    }
): Promise<DeductionResult[]> => {
    const model = new InventoryModel(connection);

    // Aggregate required quantities across all services in the event
    const neededBySupply = new Map<
        number,
        { supplyId: number; totalQuantity: number; serviceNotes: string[] }
    >();

    for (const item of opts.services) {
        const recipes = await model.listRecipes(item.serviceId);
        for (const recipe of recipes) {
            const qtyNeeded = Number(recipe.quantity_per_service) * Number(item.quantity);
            if (qtyNeeded <= 0) continue;

            const existing = neededBySupply.get(recipe.supply_id);
            if (existing) {
                existing.totalQuantity += qtyNeeded;
                existing.serviceNotes.push(`${item.quantity}x service #${item.serviceId}`);
            } else {
                neededBySupply.set(recipe.supply_id, {
                    supplyId: recipe.supply_id,
                    totalQuantity: qtyNeeded,
                    serviceNotes: [`${item.quantity}x service #${item.serviceId}`],
                });
            }
        }
    }

    // Sort by supplyId ascending to serialize row locking and avoid deadlocks
    const sortedSupplies = Array.from(neededBySupply.values()).sort(
        (a, b) => a.supplyId - b.supplyId
    );

    const results: DeductionResult[] = [];

    for (const needed of sortedSupplies) {
        const already = await model.findAutomaticMovement(
            "event",
            opts.eventId,
            needed.supplyId,
            "usage"
        );
        if (already) {
            results.push({
                supplyId: needed.supplyId,
                supplyName: already.supply_name ?? "",
                quantity: Math.abs(Number(already.quantity_delta)),
                balanceAfter: Number(already.balance_after),
            });
            continue;
        }

        const supply = await model.lockSupplyRow(needed.supplyId);
        if (!supply || supply.is_active !== 1) continue;

        const quantity = needed.totalQuantity;
        const before = Number(supply.current_quantity);
        if (before < quantity) {
            throw new ConflictError(
                `Not enough ${supply.name} in stock. Needed ${quantity} ${supply.unit}, available ${before}.`
            );
        }

        const after = before - quantity;
        await model.updateQuantity(supply.id, after);
        await model.insertMovement({
            supplyId: supply.id,
            movementType: "usage",
            quantityDelta: -quantity,
            balanceAfter: after,
            unitCost: supply.unit_cost,
            referenceType: "event",
            referenceId: opts.eventId,
            notes: `Consumed by event #${opts.eventId} (${needed.serviceNotes.join(", ")})`,
            createdBy: opts.createdBy,
        });

        await evaluateAlert(connection, supply.id, opts.createdBy);

        results.push({
            supplyId: supply.id,
            supplyName: supply.name,
            quantity,
            balanceAfter: after,
        });
    }

    return results;
};

export interface UsageReportDetail {
    serviceId: number | null;
    serviceName: string | null;
    supplyId: number;
    supplyName: string;
    unit: string;
    usedQuantity: number;
    cost: number;
}

export const getUsageReport = (
    from: Date,
    to: Date
): Promise<UsageReportDetail[]> =>
    withConnection(async (connection) => {
        const rows = await new InventoryModel(connection).usageReport(from, to);
        return rows.map((row) => ({
            serviceId: row.service_id,
            serviceName: row.service_name,
            supplyId: row.supply_id,
            supplyName: row.supply_name,
            unit: row.unit,
            usedQuantity: Number(row.used_quantity),
            cost: Number(row.cost),
        }));
    });

export const getInventorySummary = (): Promise<{
    supplies: number;
    lowStock: number;
}> =>
    withConnection(async (connection) => {
        const model = new InventoryModel(connection);
        const supplies = await model.listSupplies(true);
        return {
            supplies: supplies.length,
            lowStock: await model.lowStockCount(),
        };
    });
