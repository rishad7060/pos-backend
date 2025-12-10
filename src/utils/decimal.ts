/**
 * Utility function to convert Prisma Decimal types to JavaScript numbers
 * Prisma Decimal types from PostgreSQL need explicit conversion for JSON serialization
 */
export function decimalToNumber(value: any): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  // If already a number, return it
  if (typeof value === 'number') {
    return value;
  }

  // If it's a string, parse it
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }

  // If it's a Prisma Decimal object, use toNumber() method
  if (typeof value === 'object' && value !== null) {
    // Prisma Decimal has a toNumber() method
    if (typeof value.toNumber === 'function') {
      return value.toNumber();
    }
    // Some Decimal implementations use toString()
    if (typeof value.toString === 'function') {
      const str = value.toString();
      const parsed = parseFloat(str);
      return isNaN(parsed) ? null : parsed;
    }
  }

  // Fallback: try Number() conversion
  const num = Number(value);
  return isNaN(num) ? null : num;
}

/**
 * Convert an order object to have all Decimal fields as numbers
 */
export function serializeOrder(order: any): any {
  if (!order) return order;

  return {
    ...order,
    subtotal: decimalToNumber(order.subtotal) ?? 0,
    discountAmount: decimalToNumber(order.discountAmount) ?? 0,
    discountPercent: decimalToNumber(order.discountPercent) ?? 0,
    taxAmount: decimalToNumber(order.taxAmount) ?? 0,
    total: decimalToNumber(order.total) ?? 0,
    cashReceived: decimalToNumber(order.cashReceived),
    changeGiven: decimalToNumber(order.changeGiven),
    itemCount: order.orderItems ? order.orderItems.length : 0,
    orderItems: order.orderItems ? order.orderItems.map((item: any) => ({
      ...item,
      itemWeightKg: decimalToNumber(item.itemWeightKg) ?? 0,
      itemWeightG: decimalToNumber(item.itemWeightG) ?? 0,
      itemWeightTotalKg: decimalToNumber(item.itemWeightTotalKg) ?? 0,
      boxWeightKg: decimalToNumber(item.boxWeightKg),
      boxWeightG: decimalToNumber(item.boxWeightG),
      boxWeightPerBoxKg: decimalToNumber(item.boxWeightPerBoxKg),
      totalBoxWeightKg: decimalToNumber(item.totalBoxWeightKg),
      netWeightKg: decimalToNumber(item.netWeightKg) ?? 0,
      pricePerKg: decimalToNumber(item.pricePerKg) ?? 0,
      baseTotal: decimalToNumber(item.baseTotal) ?? 0,
      itemDiscountPercent: decimalToNumber(item.itemDiscountPercent) ?? 0,
      itemDiscountAmount: decimalToNumber(item.itemDiscountAmount) ?? 0,
      finalTotal: decimalToNumber(item.finalTotal) ?? 0,
      costPrice: decimalToNumber(item.costPrice),
    })) : [],
  };
}

