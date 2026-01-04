import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSupplier() {
  const supplier = await prisma.supplier.findUnique({
    where: { id: 3 }, // RESQ
  });

  console.log('RESQ Supplier (ID: 3):');
  console.log('Name:', supplier?.name);
  console.log('Outstanding Balance:', supplier?.outstandingBalance?.toString());
  console.log('Total Purchases:', supplier?.totalPurchases?.toString());

  await prisma.$disconnect();
}

checkSupplier();
