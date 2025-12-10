
import { PrismaClient } from '@prisma/client';
import { decimalToNumber } from '../utils/decimal';

const prisma = new PrismaClient();

async function main() {
    console.log('Starting credit history fix...');
    const customers = await prisma.customer.findMany({
        include: { orders: true }
    });

    for (const customer of customers) {
        const creditOrders = customer.orders.filter(o => o.paymentMethod === 'credit');

        // Also include split payments if applicable (logic omitted for simplicity unless critical)
        // Focusing on primary 'credit' orders for now as per user description "Total Credit Sales LKR 10000".

        if (creditOrders.length === 0) continue;

        console.log(`Checking customer ${customer.id} (${customer.name})... Found ${creditOrders.length} credit orders.`);

        // Fetch existing credits
        const existingCredits = await prisma.customerCredit.findMany({
            where: { customerId: customer.id },
            orderBy: { createdAt: 'asc' }
        });

        // Check for missing orders
        const existingOrderIds = new Set(existingCredits.map(c => c.orderId).filter(id => id !== null));
        const missingOrders = creditOrders.filter(o => !existingOrderIds.has(o.id));

        if (missingOrders.length === 0 && existingCredits.length > 0) {
            console.log('  No missing transactions.');
            // Optionally verify balance consistency?
            continue;
        }

        if (missingOrders.length > 0) {
            console.log(`  Found ${missingOrders.length} missing credit transactions. Fixing...`);
        } else {
            console.log(`  Re-verifying balances...`);
        }

        // Prepare list of ALL transactions
        const newTransactions = missingOrders.map(order => ({
            customerId: customer.id,
            orderId: order.id,
            transactionType: 'sale',
            amount: Number(order.total),
            description: `Credit purchase for Order #${order.orderNumber}`,
            userId: order.cashierId,
            createdAt: order.createdAt,
            isNew: true,
            id: -1,
            balance: 0
        }));

        const existingEvents = existingCredits.map(c => ({
            ...c,
            amount: Number(c.amount),
            balance: Number(c.balance),
            isNew: false
        }));

        const allEvents = [...existingEvents, ...newTransactions];

        // Sort by createdAt
        allEvents.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

        let runningBalance = 0;

        for (const event of allEvents) {
            runningBalance += event.amount;

            if (event.isNew) {
                await prisma.customerCredit.create({
                    data: {
                        customerId: event.customerId,
                        orderId: event.orderId,
                        transactionType: event.transactionType,
                        amount: event.amount,
                        balance: runningBalance,
                        description: event.description,
                        userId: event.userId,
                        createdAt: event.createdAt
                    }
                });
            } else {
                // Update only if balance differs (and is not null)
                if (Math.abs(event.balance - runningBalance) > 0.01) {
                    await prisma.customerCredit.update({
                        where: { id: event.id },
                        data: { balance: runningBalance }
                    });
                    console.log(`    Updated balance for tx ${event.id}`);
                }
            }
        }
        console.log(`  Fixed customer ${customer.id}. Final Balance: ${runningBalance}`);
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
