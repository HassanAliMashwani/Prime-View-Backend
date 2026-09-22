-- CreateTable
CREATE TABLE "PlotStatusHistory" (
    "id" TEXT NOT NULL,
    "plotId" TEXT NOT NULL,
    "fromStatus" "PlotStatus",
    "toStatus" "PlotStatus" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT NOT NULL,
    "reason" TEXT,
    "source" TEXT NOT NULL,

    CONSTRAINT "PlotStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlotStatusHistory_plotId_changedAt_idx" ON "PlotStatusHistory"("plotId", "changedAt");

-- CreateIndex
CREATE INDEX "PlotStatusHistory_toStatus_changedAt_idx" ON "PlotStatusHistory"("toStatus", "changedAt");

-- AddForeignKey
ALTER TABLE "PlotStatusHistory" ADD CONSTRAINT "PlotStatusHistory_plotId_fkey" FOREIGN KEY ("plotId") REFERENCES "Plot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
