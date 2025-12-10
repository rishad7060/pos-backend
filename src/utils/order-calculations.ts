/**
 * Order calculation utilities
 * All calculations should be done server-side for security and accuracy
 */

export interface RawItemInput {
  productId?: number | null;
  itemName: string;
  quantityType: 'kg' | 'g' | 'box';
  itemWeightKg: number;
  itemWeightG: number;
  boxWeightKg?: number;
  boxWeightG?: number;
  boxCount?: number;
  pricePerKg: number;
  itemDiscountPercent: number;
}

export interface CalculatedItem {
  productId: number | null;
  itemName: string;
  quantityType: string;
  itemWeightKg: number;
  itemWeightG: number;
  itemWeightTotalKg: number;
  boxWeightKg: number | null;
  boxWeightG: number | null;
  boxWeightPerBoxKg: number | null;
  boxCount: number | null;
  totalBoxWeightKg: number | null;
  netWeightKg: number;
  pricePerKg: number;
  baseTotal: number;
  itemDiscountPercent: number;
  itemDiscountAmount: number;
  finalTotal: number;
}

/**
 * Calculate item totals from raw input data
 */
export function calculateItemTotals(item: RawItemInput): CalculatedItem {
  // Validate grams input (must be 0-999)
  const validItemG = Math.min(999, Math.max(0, item.itemWeightG || 0));
  const validBoxG = Math.min(999, Math.max(0, item.boxWeightG || 0));
  
  // Convert to total kg with precision
  const itemWeightTotalKg = parseFloat((item.itemWeightKg + (validItemG / 1000)).toFixed(3));
  
  // Box calculations
  const boxWeightKg = item.boxWeightKg || 0;
  const boxCount = item.boxCount || 0;
  const boxWeightPerBoxKg = boxCount > 0 
    ? parseFloat((boxWeightKg + (validBoxG / 1000)).toFixed(3))
    : null;
  const totalBoxWeightKg = boxCount > 0 && boxWeightPerBoxKg !== null
    ? parseFloat((boxWeightPerBoxKg * boxCount).toFixed(3))
    : null;
  
  // Calculate net weight - ensure it's not negative
  const netWeightKg = parseFloat(
    Math.max(0, itemWeightTotalKg - (totalBoxWeightKg || 0)).toFixed(3)
  );
  
  // Calculate pricing
  const baseTotal = parseFloat((netWeightKg * item.pricePerKg).toFixed(2));
  const itemDiscountAmount = parseFloat((baseTotal * (item.itemDiscountPercent / 100)).toFixed(2));
  const finalTotal = parseFloat((baseTotal - itemDiscountAmount).toFixed(2));

  return {
    productId: item.productId || null,
    itemName: item.itemName,
    quantityType: item.quantityType || 'kg',
    itemWeightKg: item.itemWeightKg,
    itemWeightG: validItemG,
    itemWeightTotalKg,
    boxWeightKg: boxWeightKg > 0 ? boxWeightKg : null,
    boxWeightG: validBoxG > 0 ? validBoxG : null,
    boxWeightPerBoxKg,
    boxCount: boxCount > 0 ? boxCount : null,
    totalBoxWeightKg,
    netWeightKg,
    pricePerKg: item.pricePerKg,
    baseTotal,
    itemDiscountPercent: item.itemDiscountPercent || 0,
    itemDiscountAmount,
    finalTotal,
  };
}

/**
 * Calculate order totals from calculated items
 */
export interface OrderTotals {
  subtotal: number;
  discountAmount: number;
  discountPercent: number;
  taxAmount: number;
  total: number;
}

export function calculateOrderTotals(
  items: CalculatedItem[],
  discountPercent: number = 0,
  taxPercent: number = 0
): OrderTotals {
  // Calculate subtotal from all items
  const subtotal = items.reduce((sum, item) => sum + item.finalTotal, 0);
  
  // Calculate discount
  const discountAmount = parseFloat(((subtotal * discountPercent) / 100).toFixed(2));
  const totalAfterDiscount = subtotal - discountAmount;
  
  // Calculate tax
  const taxAmount = parseFloat(((totalAfterDiscount * taxPercent) / 100).toFixed(2));
  const total = parseFloat((totalAfterDiscount + taxAmount).toFixed(2));

  return {
    subtotal: parseFloat(subtotal.toFixed(2)),
    discountAmount,
    discountPercent,
    taxAmount,
    total,
  };
}

/**
 * Validate item calculations
 */
export function validateItem(item: RawItemInput): { valid: boolean; error?: string } {
  if (!item.itemName || item.itemName.trim() === '') {
    return { valid: false, error: 'Item name is required' };
  }
  
  if (item.pricePerKg <= 0) {
    return { valid: false, error: 'Price per kg must be greater than 0' };
  }
  
  if (item.itemWeightKg < 0) {
    return { valid: false, error: 'Item weight cannot be negative' };
  }
  
  if ((item.itemWeightKg + (item.itemWeightG || 0) / 1000) <= 0) {
    return { valid: false, error: 'Total item weight must be greater than 0' };
  }
  
  const calculated = calculateItemTotals(item);
  if (calculated.netWeightKg <= 0) {
    return { valid: false, error: 'Net weight must be greater than 0' };
  }
  
  if (calculated.totalBoxWeightKg !== null && calculated.totalBoxWeightKg > calculated.itemWeightTotalKg) {
    return { valid: false, error: 'Box weight cannot exceed item weight' };
  }
  
  return { valid: true };
}


