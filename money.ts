/**
 * Decimal-safe monetary calculation utilities.
 * All intermediate calculations are executed in integer paise (1 INR = 100 paise)
 * to eliminate IEEE-754 floating-point rounding errors.
 */

export function toPaise(amount: string | number | null | undefined): number {
  if (amount === null || amount === undefined || amount === '') return 0;
  const str = typeof amount === 'number' ? amount.toFixed(2) : String(amount).trim();
  const normalized = str.replace(/[^0-9.-]/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid monetary value: ${amount}`);
  }
  return Math.round(parsed * 100);
}

export function fromPaise(paise: number): string {
  const safe = Math.round(paise);
  const sign = safe < 0 ? '-' : '';
  const abs = Math.abs(safe);
  const rupees = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  return `${sign}${rupees}.${rem}`;
}

export interface PriceBreakdownInput {
  items: { unitPrice: string | number; quantity: number }[];
  branchDeliveryFee: string | number;
  couponCode?: string | null;
  taxRatePercent?: string | number;
  packagingFeeInr?: string | number;
  freeDeliveryThresholdInr?: string | number;
}

export interface PriceBreakdownResult {
  subtotal: string;
  deliveryFee: string;
  packagingFee: string;
  taxAmount: string;
  discountAmount: string;
  finalTotal: string;
  appliedCoupon: string | null;
  discountReason: string | null;
  freeDeliveryApplied: boolean;
  taxRatePercent: string;
}

export function calculateOrderPricing(input: PriceBreakdownInput): PriceBreakdownResult {
  const taxRateStr = String(input.taxRatePercent ?? process.env.TAX_RATE_PERCENT ?? '5.00');
  const packagingStr = String(input.packagingFeeInr ?? process.env.PACKAGING_FEE_INR ?? '15.00');
  const freeThresholdStr = String(
    input.freeDeliveryThresholdInr ?? process.env.FREE_DELIVERY_THRESHOLD_INR ?? '499.00'
  );

  // 1. Item subtotal in integer paise
  let subtotalPaise = 0;
  for (const item of input.items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new Error(`Invalid item quantity: ${item.quantity}`);
    }
    const unitPaise = toPaise(item.unitPrice);
    subtotalPaise += unitPaise * item.quantity;
  }

  if (subtotalPaise === 0) {
    return {
      subtotal: '0.00',
      deliveryFee: '0.00',
      packagingFee: '0.00',
      taxAmount: '0.00',
      discountAmount: '0.00',
      finalTotal: '0.00',
      appliedCoupon: null,
      discountReason: null,
      freeDeliveryApplied: false,
      taxRatePercent: taxRateStr,
    };
  }

  const deliveryFeePaise = toPaise(input.branchDeliveryFee);
  const packagingFeePaise = toPaise(packagingStr);
  const freeThresholdPaise = toPaise(freeThresholdStr);

  // 2. Discounts (Coupon or automatic free delivery above threshold)
  let discountPaise = 0;
  let appliedCoupon: string | null = null;
  let discountReason: string | null = null;
  let freeDeliveryApplied = false;

  const normalizedCoupon = input.couponCode ? input.couponCode.trim().toUpperCase() : null;

  if (normalizedCoupon === 'CRAVE75' && subtotalPaise >= toPaise('399.00')) {
    discountPaise = toPaise('75.00');
    appliedCoupon = 'CRAVE75';
    discountReason = 'Flat ₹75 OFF on orders ₹399+';
  } else if (normalizedCoupon === 'FIRST50' && subtotalPaise >= toPaise('249.00')) {
    discountPaise = toPaise('50.00');
    appliedCoupon = 'FIRST50';
    discountReason = 'Welcome ₹50 OFF on orders ₹249+';
  } else if (normalizedCoupon === 'CRAVE20' && subtotalPaise >= toPaise('449.00')) {
    // 20% off up to ₹120
    discountPaise = Math.min(Math.round((subtotalPaise * 20) / 100), toPaise('120.00'));
    appliedCoupon = 'CRAVE20';
    discountReason = '20% OFF (up to ₹120)';
  } else if (subtotalPaise >= freeThresholdPaise && deliveryFeePaise > 0) {
    discountPaise = deliveryFeePaise;
    freeDeliveryApplied = true;
    discountReason = `Free delivery on orders above ₹${fromPaise(freeThresholdPaise)}`;
  }

  // Ensure discount never exceeds subtotal + deliveryFee
  discountPaise = Math.min(discountPaise, subtotalPaise);

  // 3. Tax calculation: taxRatePercent (e.g. 5.00% GST) on net food subtotal
  const taxBasisPaise = Math.max(0, subtotalPaise - (freeDeliveryApplied ? 0 : discountPaise));
  const taxRateBasisPoints = Math.round(Number(taxRateStr) * 100); // 5.00% -> 500 bps
  const taxAmountPaise = Math.round((taxBasisPaise * taxRateBasisPoints) / 10000);

  // 4. Final total in paise
  const finalTotalPaise = Math.max(
    0,
    subtotalPaise + deliveryFeePaise + packagingFeePaise + taxAmountPaise - discountPaise
  );

  return {
    subtotal: fromPaise(subtotalPaise),
    deliveryFee: fromPaise(deliveryFeePaise),
    packagingFee: fromPaise(packagingFeePaise),
    taxAmount: fromPaise(taxAmountPaise),
    discountAmount: fromPaise(discountPaise),
    finalTotal: fromPaise(finalTotalPaise),
    appliedCoupon,
    discountReason,
    freeDeliveryApplied,
    taxRatePercent: taxRateStr,
  };
}
