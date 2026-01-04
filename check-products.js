const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkProducts() {
  try {
    const totalProducts = await prisma.product.count();
    console.log('📦 Total products in database:', totalProducts);

    const activeProducts = await prisma.product.count({
      where: { isActive: true }
    });
    console.log('✅ Active products:', activeProducts);

    if (activeProducts > 0) {
      const sampleProducts = await prisma.product.findMany({
        where: { isActive: true },
        take: 5,
        select: {
          id: true,
          name: true,
          sku: true,
          stockQuantity: true,
          defaultPricePerKg: true,
          unitType: true,
          isActive: true
        }
      });
      console.log('\n📋 Sample products:');
      sampleProducts.forEach(p => {
        console.log(`  - ${p.name} (ID: ${p.id}, SKU: ${p.sku}, Stock: ${p.stockQuantity}, Active: ${p.isActive})`);
      });
    }
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkProducts();
