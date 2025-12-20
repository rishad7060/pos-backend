-- AlterTable
ALTER TABLE "price_change_history" ADD COLUMN     "orderId" INTEGER;

-- AddForeignKey
ALTER TABLE "price_change_history" ADD CONSTRAINT "price_change_history_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
