export type CommissionRateType = "percent" | "fixed";

export interface CommissionRule {
    id: number;
    staffId: number | null;
    serviceId: number | null;
    serviceCategory: string | null;
    rateType: CommissionRateType;
    rateValue: number;
    effectiveFrom: string;
    effectiveTo: string | null;
    priority: number;
    isActive: boolean;
}

export interface CommissionContext {
    staffId: number;
    serviceId: number | null;
    serviceCategory: string | null;
    date: string; // YYYY-MM-DD
}

/** Higher is more specific. */
export const ruleSpecificity = (rule: CommissionRule): number => {
    if (rule.staffId !== null && rule.serviceId !== null) return 5;
    if (rule.staffId !== null && rule.serviceCategory !== null) return 4;
    if (rule.staffId !== null) return 3;
    if (rule.serviceId !== null) return 2;
    if (rule.serviceCategory !== null) return 2;
    return 1;
};

const matches = (rule: CommissionRule, context: CommissionContext): boolean => {
    if (!rule.isActive) return false;
    if (rule.effectiveFrom > context.date) return false;
    if (rule.effectiveTo !== null && rule.effectiveTo < context.date) return false;
    if (rule.staffId !== null && rule.staffId !== context.staffId) return false;
    if (rule.serviceId !== null && rule.serviceId !== context.serviceId) return false;
    if (
        rule.serviceCategory !== null &&
        rule.serviceCategory !== context.serviceCategory
    ) {
        return false;
    }
    return true;
};

/**
 * Picks the most specific active rule for the context. Ties are broken by
 * priority (higher first), then the most recent effective date, then id.
 */
export const resolveCommissionRule = (
    rules: CommissionRule[],
    context: CommissionContext
): CommissionRule | null => {
    const eligible = rules.filter((rule) => matches(rule, context));
    if (eligible.length === 0) return null;

    return eligible.sort((a, b) => {
        const specificity = ruleSpecificity(b) - ruleSpecificity(a);
        if (specificity !== 0) return specificity;
        if (b.priority !== a.priority) return b.priority - a.priority;
        if (a.effectiveFrom !== b.effectiveFrom) {
            return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
        }
        return b.id - a.id;
    })[0]!;
};

/** Rounds half-up to two decimals without floating-point drift. */
export const roundMoney = (value: number): number =>
    Math.round((value + Number.EPSILON) * 100) / 100;

export const calculateCommission = (
    baseAmount: number,
    rule: CommissionRule | null
): number => {
    if (!rule || baseAmount <= 0) return 0;
    if (rule.rateType === "fixed") return roundMoney(Math.min(rule.rateValue, baseAmount));
    return roundMoney((baseAmount * rule.rateValue) / 100);
};
