import type { PaymentMethod, PaymentStatus } from "../model/transactions.js";

export const PAYMENT_METHODS: PaymentMethod[] = ["cash", "gcash", "card", "other"];
export const PAYMENT_STATUSES: PaymentStatus[] = ["paid", "unpaid", "waived"];
