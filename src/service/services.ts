import ServiceModel from "../model/services.js";
import { withConnection } from "../helper/withConnection.js";
import { ConflictError, NotFoundError } from "../helper/error.js";

// Types
import type {
    CreateServiceInput,
    ServiceRow,
    UpdateServiceInput,
} from "../constant/services.js";

export const listServices = (includeInactive: boolean): Promise<ServiceRow[]> =>
    withConnection((connection) => new ServiceModel(connection).list(includeInactive));

/** Loads a service or throws a 404. */
export const getService = async (id: number): Promise<ServiceRow> => {
    const service = await withConnection((connection) =>
        new ServiceModel(connection).findById(id)
    );

    if (!service) {
        throw new NotFoundError("Service not found", 404);
    }

    return service;
};

export const createService = (input: CreateServiceInput): Promise<ServiceRow> =>
    withConnection(async (connection) => {
        const model = new ServiceModel(connection);

        if (await model.findByName(input.name)) {
            throw new ConflictError("A service with this name already exists");
        }

        const id = await model.create(input);
        return (await model.findById(id))!;
    });

export const updateService = (
    id: number,
    input: UpdateServiceInput
): Promise<ServiceRow> =>
    withConnection(async (connection) => {
        const model = new ServiceModel(connection);

        if (!(await model.findById(id))) {
            throw new NotFoundError("Service not found", 404);
        }

        const clash = await model.findByName(input.name);
        if (clash && clash.id !== id) {
            throw new ConflictError("A service with this name already exists");
        }

        await model.update(id, input);
        return (await model.findById(id))!;
    });

export const setServiceActive = (id: number, isActive: boolean): Promise<ServiceRow> =>
    withConnection(async (connection) => {
        const model = new ServiceModel(connection);

        if (!(await model.findById(id))) {
            throw new NotFoundError("Service not found", 404);
        }

        await model.setActive(id, isActive);
        return (await model.findById(id))!;
    });

/** Deletes a service, unless appointment history references it. */
export const deleteService = (id: number): Promise<void> =>
    withConnection(async (connection) => {
        const model = new ServiceModel(connection);

        if (!(await model.findById(id))) {
            throw new NotFoundError("Service not found", 404);
        }

        const appointmentCount = await model.countAppointments(id);
        if (appointmentCount > 0) {
            throw new ConflictError(
                "This service has appointment history and cannot be deleted. Deactivate it instead."
            );
        }

        await model.delete(id);
    });
