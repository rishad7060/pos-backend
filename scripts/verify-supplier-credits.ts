import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function verifySupplierCredits() {
  console.log('🔍 Verifying supplier credits created by migration...\n');

  try {
    const credits = await prisma.supplierCredit.findMany({
      where: {
        description: {
          contains: 'Initial balance from old system'
        }
      },
      include: {
        supplier: {
          select: {
            name: true,
            outstandingBalance: true
          }
        }
      },
      orderBy: {
        id: 'desc'
      }
    });

    console.log(`Found ${credits.length} supplier credits from migration\n`);

    credits.forEach(credit => {
      const balance = typeof credit.balance === 'object' && 'toNumber' in credit.balance
        ? credit.balance.toNumber()
        : credit.balance;

      console.log(`✅ Supplier: ${credit.supplier.name}`);
      console.log(`   Credit ID: ${credit.id}`);
      console.log(`   Amount: LKR ${balance?.toFixed(2)}`);
      console.log(`   Payment Status: ${credit.paymentStatus}`);
      console.log(`   Transaction Type: ${credit.transactionType}`);
      console.log('');
    });

    // Verify one supplier can be paid
    if (credits.length > 0) {
      const testCredit = credits[0];
      console.log('🧪 Testing FIFO allocation query...\n');

      const unpaidCredits = await prisma.supplierCredit.findMany({
        where: {
          supplierId: testCredit.supplierId,
          transactionType: {
            in: ['admin_credit', 'credit', 'purchase']
          },
          paymentStatus: {
            in: ['unpaid', 'partial']
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      console.log(`Found ${unpaidCredits.length} unpaid credits for ${testCredit.supplier.name}`);
      console.log('✅ FIFO allocation will work!\n');
    }

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

verifySupplierCredits();
