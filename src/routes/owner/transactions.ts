import { Router } from "express";
import * as transactionsController from "../../controller/transactions.js";

/** Owner transaction management. Mounted at /api/owner (owner-only). */
const router = Router();

router.get("/transactions", transactionsController.listTransactions);
router.get("/transactions/:id", transactionsController.getTransaction);
router.patch("/transactions/:id", transactionsController.updateTransaction);

// Appointment sub-resource: transaction linked to a specific appointment
router.get("/appointments/:id/transaction", transactionsController.getTransactionByAppointment);

// Dashboard KPI
router.get("/dashboard/summary", transactionsController.getDashboardSummary);

// Owner reports
router.get("/reports/yearly", transactionsController.getYearlyReport);

export default router;
