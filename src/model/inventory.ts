import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { InternalServerError, isDuplicateKeyError } from "../helper/error.js";
import { safeRowLimit } from "../helper/sql.js";

// Types
import type {
    AlertStatus,
    ManualMovementType,
    StockMovementType,
    SupplyCategory,
} from "../constant/inventory.js";

export type SupplyRow = {
    id: number;
    sku: string;
    name: string;
    category: SupplyCategory;
    unit: string;
    current_quantity: number;
    reorder_level: number;
    unit_cost: number | null;
    supplier: string | null;
    notes: string | null;
    is_active: number;
    is_low_stock: number;
    created_at: Date;
    updated_at: Date | null;
};

export type MovementRow = {
    id: number;
    supply_id: number;
    supply_name: string;
    movement_type: StockMovementType;
    quantity_delta: number;
    balance_after: number;
    unit_cost: number | null;
    reference_type: string | null;
    reference_id: number | null;
    notes: string | null;
    created_by: number | null;
    created_at: Date;
};

export type RecipeRow = {
    id: number;
    service_id: number;
    supply_id: number;
    supply_name: string;
    unit: string;
    quantity_per_service: number;
    is_active: number;
};

export type InventoryAlertRow = {
    id: number;
    supply_id: number;
    supply_name: string;
    alert_type: "low_stock" | "out_of_stock";
    status: AlertStatus;
    current_quantity: number;
    reorder_level: number;
    acknowledged_at: Date | null;
    resolved_at: Date | null;
    notes: string | null;
    created_at: Date;
};

export type UsageReportRow = {
    service_id: number | null;
    service_name: string | null;
    supply_id: number;
    supply_name: string;
    unit: string;
    used_quantity: number;
    cost: number;
};

const SUPPLY_COLUMNS = `
    SELECT id, sku, name, category, unit, current_quantity, reorder_level,
           unit_cost, supplier, notes, is_active,
           (current_quantity <= reorder_level) AS is_low_stock,
           created_at, updated_at
    FROM supplies
`;

export default class InventoryModel {
    constructor(private connection: PoolConnection) {}

    async listSupplies(includeInactive: boolean): Promise<SupplyRow[]> {
        try {
            const where = includeInactive ? "" : "WHERE is_active = 1";
            const [rows] = await this.connection.query<RowDataPacket[]>(
                `${SUPPLY_COLUMNS} ${where} ORDER BY name`
            );
            return rows as SupplyRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findSupplyById(id: number): Promise<SupplyRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SUPPLY_COLUMNS} WHERE id = ? LIMIT 1`,
                [id]
            );
            return (rows[0] as SupplyRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findSupplyBySku(sku: string): Promise<SupplyRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SUPPLY_COLUMNS} WHERE sku = ? LIMIT 1`,
                [sku]
            );
            return (rows[0] as SupplyRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Locks a supply row for a stock write. Must run inside a transaction. */
    async lockSupplyRow(id: number): Promise<SupplyRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `${SUPPLY_COLUMNS} WHERE id = ? FOR UPDATE`,
                [id]
            );
            return (rows[0] as SupplyRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async createSupply(input: {
        sku: string;
        name: string;
        category: SupplyCategory;
        unit: string;
        currentQuantity?: number | undefined;
        reorderLevel: number;
        unitCost: number | null;
        supplier: string | null;
        notes: string | null;
    }): Promise<number> {
        const initialQty = input.currentQuantity ?? 0;
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO supplies
                    (sku, name, category, unit, current_quantity, reorder_level, unit_cost, supplier, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    input.sku,
                    input.name,
                    input.category,
                    input.unit,
                    initialQty,
                    input.reorderLevel,
                    input.unitCost,
                    input.supplier,
                    input.notes,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateSupply(
        id: number,
        input: {
            sku: string;
            name: string;
            category: SupplyCategory;
            unit: string;
            reorderLevel: number;
            unitCost: number | null;
            supplier: string | null;
            notes: string | null;
        }
    ): Promise<void> {
        try {
            await this.connection.execute(
                `UPDATE supplies
                 SET sku = ?, name = ?, category = ?, unit = ?, reorder_level = ?,
                     unit_cost = ?, supplier = ?, notes = ?
                 WHERE id = ?`,
                [
                    input.sku,
                    input.name,
                    input.category,
                    input.unit,
                    input.reorderLevel,
                    input.unitCost,
                    input.supplier,
                    input.notes,
                    id,
                ]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async setSupplyActive(id: number, isActive: boolean): Promise<void> {
        try {
            await this.connection.execute("UPDATE supplies SET is_active = ? WHERE id = ?", [
                isActive ? 1 : 0,
                id,
            ]);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async updateQuantity(id: number, quantity: number): Promise<void> {
        try {
            await this.connection.execute(
                "UPDATE supplies SET current_quantity = ? WHERE id = ?",
                [quantity, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async insertMovement(input: {
        supplyId: number;
        movementType: StockMovementType;
        quantityDelta: number;
        balanceAfter: number;
        unitCost: number | null;
        referenceType: "appointment" | "event" | "manual" | "purchase" | null;
        referenceId: number | null;
        notes: string | null;
        createdBy: number | null;
    }): Promise<number> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO supply_movements
                    (supply_id, movement_type, quantity_delta, balance_after, unit_cost,
                     reference_type, reference_id, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    input.supplyId,
                    input.movementType,
                    input.quantityDelta,
                    input.balanceAfter,
                    input.unitCost,
                    input.referenceType,
                    input.referenceId,
                    input.notes,
                    input.createdBy,
                ]
            );
            return result.insertId;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findAutomaticMovement(
        referenceType: "appointment" | "event",
        referenceId: number,
        supplyId: number,
        movementType: StockMovementType
    ): Promise<MovementRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT m.id, m.supply_id, s.name AS supply_name, m.movement_type,
                        m.quantity_delta, m.balance_after, m.unit_cost,
                        m.reference_type, m.reference_id, m.notes, m.created_by, m.created_at
                 FROM supply_movements m
                 JOIN supplies s ON s.id = m.supply_id
                 WHERE m.reference_type = ? AND m.reference_id = ?
                   AND m.supply_id = ? AND m.movement_type = ?
                 LIMIT 1`,
                [referenceType, referenceId, supplyId, movementType]
            );
            return (rows[0] as MovementRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listMovements(supplyId: number, limit = 100): Promise<MovementRow[]> {
        try {
            const safeLimit = safeRowLimit(limit, 100);
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT m.id, m.supply_id, s.name AS supply_name, m.movement_type,
                        m.quantity_delta, m.balance_after, m.unit_cost,
                        m.reference_type, m.reference_id, m.notes, m.created_by, m.created_at
                 FROM supply_movements m
                 JOIN supplies s ON s.id = m.supply_id
                 WHERE m.supply_id = ?
                 ORDER BY m.created_at DESC, m.id DESC
                 LIMIT ${safeLimit}`,
                [supplyId]
            );
            return rows as MovementRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listRecipes(serviceId: number): Promise<RecipeRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT r.id, r.service_id, r.supply_id, s.name AS supply_name,
                        r.unit, r.quantity_per_service, r.is_active
                 FROM service_supply_usage r
                 JOIN supplies s ON s.id = r.supply_id
                 WHERE r.service_id = ? AND r.is_active = 1
                 ORDER BY s.name`,
                [serviceId]
            );
            return rows as RecipeRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listAllRecipes(): Promise<RecipeRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT r.id, r.service_id, r.supply_id, s.name AS supply_name,
                        r.unit, r.quantity_per_service, r.is_active
                 FROM service_supply_usage r
                 JOIN supplies s ON s.id = r.supply_id
                 WHERE r.is_active = 1
                 ORDER BY r.service_id, s.name`
            );
            return rows as RecipeRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async replaceRecipes(
        serviceId: number,
        items: Array<{ supplyId: number; quantityPerService: number; unit: string }>
    ): Promise<void> {
        try {
            await this.connection.execute(
                "DELETE FROM service_supply_usage WHERE service_id = ?",
                [serviceId]
            );
            for (const item of items) {
                await this.connection.execute(
                    `INSERT INTO service_supply_usage
                        (service_id, supply_id, quantity_per_service, unit)
                     VALUES (?, ?, ?, ?)`,
                    [serviceId, item.supplyId, item.quantityPerService, item.unit]
                );
            }
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async findOpenAlert(supplyId: number): Promise<InventoryAlertRow | null> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT a.id, a.supply_id, s.name AS supply_name, a.alert_type, a.status,
                        a.current_quantity, a.reorder_level, a.acknowledged_at,
                        a.resolved_at, a.notes, a.created_at
                 FROM inventory_alerts a
                 JOIN supplies s ON s.id = a.supply_id
                 WHERE a.supply_id = ? AND a.status IN ('open','acknowledged')
                 LIMIT 1`,
                [supplyId]
            );
            return (rows[0] as InventoryAlertRow | undefined) ?? null;
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Returns null when an open alert already exists. */
    async createAlert(input: {
        supplyId: number;
        alertType: "low_stock" | "out_of_stock";
        currentQuantity: number;
        reorderLevel: number;
    }): Promise<number | null> {
        try {
            const [result] = await this.connection.execute<ResultSetHeader>(
                `INSERT INTO inventory_alerts
                    (supply_id, alert_type, current_quantity, reorder_level)
                 VALUES (?, ?, ?, ?)`,
                [input.supplyId, input.alertType, input.currentQuantity, input.reorderLevel]
            );
            return result.insertId;
        } catch (err) {
            if (isDuplicateKeyError(err)) return null;
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async listAlerts(status: AlertStatus | null): Promise<InventoryAlertRow[]> {
        try {
            const where = status ? "WHERE a.status = ?" : "";
            const params = status ? [status] : [];
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT a.id, a.supply_id, s.name AS supply_name, a.alert_type, a.status,
                        a.current_quantity, a.reorder_level, a.acknowledged_at,
                        a.resolved_at, a.notes, a.created_at
                 FROM inventory_alerts a
                 JOIN supplies s ON s.id = a.supply_id
                 ${where}
                 ORDER BY a.created_at DESC, a.id DESC`,
                params
            );
            return rows as InventoryAlertRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async acknowledgeAlert(id: number, userId: number): Promise<void> {
        try {
            await this.connection.execute(
                "UPDATE inventory_alerts SET status = 'acknowledged', acknowledged_by = ?, acknowledged_at = NOW() WHERE id = ? AND status = 'open'",
                [userId, id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async resolveAlert(id: number): Promise<void> {
        try {
            await this.connection.execute(
                "UPDATE inventory_alerts SET status = 'resolved', resolved_at = NOW() WHERE id = ? AND status IN ('open','acknowledged')",
                [id]
            );
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Usage and cost grouped by service + supply for a date range. */
    async usageReport(from: Date, to: Date): Promise<UsageReportRow[]> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT a.service_id, sv.name AS service_name,
                        m.supply_id, s.name AS supply_name, s.unit,
                        COALESCE(SUM(-m.quantity_delta), 0) AS used_quantity,
                        COALESCE(SUM(-m.quantity_delta * COALESCE(m.unit_cost, s.unit_cost, 0)), 0) AS cost
                 FROM supply_movements m
                 JOIN supplies s ON s.id = m.supply_id
                 LEFT JOIN appointments a
                    ON m.reference_type = 'appointment' AND a.id = m.reference_id
                 LEFT JOIN services sv ON sv.id = a.service_id
                 WHERE m.movement_type = 'usage'
                   AND m.created_at >= ? AND m.created_at < ?
                 GROUP BY a.service_id, sv.name, m.supply_id, s.name, s.unit
                 ORDER BY used_quantity DESC`,
                [from, to]
            );
            return rows as UsageReportRow[];
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    /** Cost of stock consumed by an appointment or event reference. */
    async sumUsageCost(
        referenceType: "appointment" | "event",
        referenceId: number
    ): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                `SELECT COALESCE(SUM(-quantity_delta * COALESCE(unit_cost, 0)), 0) AS cost
                 FROM supply_movements
                 WHERE reference_type = ? AND reference_id = ?
                   AND quantity_delta < 0`,
                [referenceType, referenceId]
            );
            return Number(rows[0]?.cost ?? 0);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async lowStockCount(): Promise<number> {
        try {
            const [rows] = await this.connection.execute<RowDataPacket[]>(
                "SELECT COUNT(*) AS total FROM supplies WHERE is_active = 1 AND current_quantity <= reorder_level"
            );
            return Number(rows[0]?.total ?? 0);
        } catch (err) {
            throw new InternalServerError("Internal Server Error", 500, err);
        }
    }

    async adjustManualMovementTypeMatches(type: ManualMovementType): Promise<boolean> {
        // Kept as a small guard for callers that pass a raw string.
        return [
            "initial",
            "purchase",
            "adjustment",
            "waste",
            "return",
        ].includes(type);
    }
}
