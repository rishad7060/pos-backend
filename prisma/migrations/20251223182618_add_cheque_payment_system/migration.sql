-- CreateTable
CREATE TABLE "cheques" (
    "id" SERIAL NOT NULL,
    "chequeNumber" TEXT NOT NULL,
    "chequeDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "payerName" TEXT NOT NULL,
    "payeeName" TEXT,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transactionType" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3),
    "depositDate" TIMESTAMP(3),
    "clearanceDate" TIMESTAMP(3),
    "bounceDate" TIMESTAMP(3),
    "orderId" INTEGER,
    "customerId" INTEGER,
    "purchasePaymentId" INTEGER,
    "supplierId" INTEGER,
    "userId" INTEGER,
    "approvedBy" INTEGER,
    "notes" TEXT,
    "bounceReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cheques_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cheques_chequeNumber_key" ON "cheques"("chequeNumber");

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_purchasePaymentId_fkey" FOREIGN KEY ("purchasePaymentId") REFERENCES "purchase_payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
