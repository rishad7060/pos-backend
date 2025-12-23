-- AlterTable
ALTER TABLE "cheques" ADD COLUMN     "depositReminderDate" TIMESTAMP(3),
ADD COLUMN     "endorsedById" INTEGER,
ADD COLUMN     "endorsedDate" TIMESTAMP(3),
ADD COLUMN     "endorsedTo" TEXT,
ADD COLUMN     "isEndorsed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastReminderDate" TIMESTAMP(3),
ADD COLUMN     "reminderSent" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_endorsedById_fkey" FOREIGN KEY ("endorsedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
