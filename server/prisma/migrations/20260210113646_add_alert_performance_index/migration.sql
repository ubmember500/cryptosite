-- CreateIndex
CREATE INDEX "Alert_isActive_triggered_alertType_idx" ON "Alert"("isActive", "triggered", "alertType");
