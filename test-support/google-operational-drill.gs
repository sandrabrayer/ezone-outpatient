// STANDALONE ISOLATED PROJECT ONLY. No web deployment or production Code.gs.
// Build with an explicitly authorized test project ID; the checked-in file
// refuses to run. Run the five entry points separately, in the listed order.
function prepareOperationalDrill() { return op03Drill_('prepare'); }
function captureOperationalDrill() { return op03Drill_('capture'); }
function restoreOperationalDrill() { return op03Drill_('restore'); }
function verifyOperationalDrill() { return op03Drill_('verify'); }
function verifyManualTabDrill() { return op03Drill_('manual'); }

function op03Drill_(phase) {
  var expectedScriptId = "ISOLATED_SCRIPT_ID_REQUIRED";
  if (expectedScriptId === 'ISOLATED_SCRIPT_ID_REQUIRED' ||
      ScriptApp.getScriptId() !== expectedScriptId) throw new Error('Wrong isolated script project');
  // A bound project can be an application. This drill requires a standalone one.
  if (SpreadsheetApp.getActiveSpreadsheet()) throw new Error('Standalone test project required');
  var metadata = {"sourceCodeSHA256":"3039fb8cbb80752b6eed4d7e5505db65034a29274bd197c334209df6fbecfe36","helperSHA256":"958417723f3d6e50add7c83368384f222e43ebf2beff7c1cf096076c361a5d59","drillDefinitionSHA256":"dc7f117b34a777c6d0ad79647cffd5ca4f94d08b7075efdc0a2a3851152c8afa","helpers":["AUDIT_LOG_HEADERS","AUDIT_LOG_SHEET","BILLING_PRICES","CHARGES_HEADERS","CLIENTS_DATA_VERSION_PROP","CLIENTS_HEADERS","CLIENTS_REMOVED_HEADERS","CLINICAL_TO_BILLING","CONTINUATION_HEADERS","CONTINUATION_SHEET","COVERAGE_MAX_DAYS","CREDIT_COLUMNS","DAY_CENTER_BILLING","DAY_CENTER_MONTHLY_BY_FREQ","EXTRA_SESSION_HEADERS","FINANCIAL_OP_HEADERS","FINANCIAL_OP_STATES","GROUP_BILLING","INTEGRITY_APPROVED_MANUAL_POLICY_SHA256","INTEGRITY_DATA_SNAPSHOT_RE","INTEGRITY_SNAPSHOT_PREFIX","LEADS_HEADERS","PACKAGE_CATALOG_HEADERS","PACKAGE_REQUEST_HEADERS","PACKAGE_TEXT_COLUMNS","PAYMENTS_HEADERS","PAYMENT_TEXT_COLUMNS","PHONE_COLUMNS","PSYCHIATRIST_RATES","REMOVED_LEADS_HEADERS","REPAIR_PLAN_HEADERS","REPAIR_PLAN_SHEET","SESSION_LOG_HEADERS","SESSION_STATUS_BY_OUTCOME","SETTINGS_HEADERS","STAMP_COLUMNS","STOP_ALERTS_HEADERS","STOP_ALERTS_SHEET","STOP_FLAGS_HEADERS","THERAPIST_FLAT_RATES","THERAPIST_RATES_HEADERS","THERAPIST_RATES_SHEET","_applyExtraCharge","_applyRenewal","_asISODate","_billingPrice","_bumpDataVersion","_clampDayIso","_clinicalToBilling","_computeSessionPay","_computeSessionValue","_coverageDateISO","_coveragePeriodError","_ensurePaymentsSheet","_ensureSheet","_extraAppend","_extraIntent","_extraIntentV1Error","_extraObservationMatches","_extraReadback","_extraRows","_extraSame","_finActive","_finAddMonth","_finClient","_finDue","_finGuard","_finGuardRewrite","_finIntent","_finIntentError","_finJournal","_finNext","_finPaymentOwner","_finPayments","_finRow","_finSnapshot","_finSummary","_finWrite","_formatPhoneColumns","_hasOwn","_integrityCaptureData","_integrityFingerprint","_integrityManualPolicyRows","_integrityOtherPrefix","_integrityRecoveryMetadata","_integritySourceSpecs","_integrityValidateRestoreSet","_integrityVerifyGrid","_integrityVerifyManualPolicy","_integrityVerifyManualTarget","_integrityVerifyRecoveredWorkbook","_integrityWriteSnapshot","_isDayCenterBilling","_isRealCalendarDate","_isTextForcedColumn","_loadTherapistRates","_markForwarded","_monthKey","_nextCycleDueDate","_payoutMonthOf","_planWeeklyFrequency","_readAll","_readDataVersion","_recordSessionOutcome","_recoverPhone","_requestUser","_ss","_stampClientRowAt","_therapistPay","_toCredits","_toNumberOrZero","_todayISODate","_writeAll","_writeCreditsOwed","beginOutpatientRecovery","finishOutpatientRecovery"]};
  var fixture = {"grids":{"Leads":[["id","name","phone","serviceType","location","note","stage","sessionsPerWeek","pricePerSession","startDate","created","introDateTime","house_of_origin","not_relevant_reason","not_relevant_note","assignedTo","updatedAt","updatedBy"]],"Clients":[["id","name","serviceType","location","sessionsPerWeek","pricePerSession","startDate","status","exitDate","fromLead","source","notes","billingType","billingDay","bundleSize","bundlePrice","sessionsUsed","bundlePaid","house_of_origin","responsiblePerson","serviceScope","treatmentContactPhone","payerName","payerPhone","paymentLink","phone","paymentStatus","paymentDate","nextBillingDate","creditsOwed","clinicalTreatmentType","packageChangeDate","assignedTo","paymentAmountOverrides","updatedAt","updatedBy","plannedExitDate"],["journal-client","בדיקת חידוש","פרטני","","{\"פרטני\":1}",600,"2026-01-31","פעיל","","","","","",31,"","","","","","","","","","","","0500000001","","2026-02-25","2026-03-31","","","","","","2026-10-20T10:00:00.000Z","",""],["drill-session-client","בדיקת שחזור סינתטית","","","1","","","פעיל","","","","","","","","","","","","","","","","","","0500000099","","","",1,"","","","","2026-10-20T10:00:00.000Z","",""]],"FinancialOps":[["id","clientId","cycleDate","paymentId","intent","state","before","after","createdAt","updatedAt","updatedBy","resolution"],["renewal-fixture-0001","journal-client","2026-02-28","pay::journal-client::base::2026-02","{\"opId\":\"renewal-fixture-0001\",\"clientId\":\"journal-client\",\"snapshot\":\"{\\\"headers\\\":[\\\"id\\\",\\\"name\\\",\\\"serviceType\\\",\\\"location\\\",\\\"sessionsPerWeek\\\",\\\"pricePerSession\\\",\\\"startDate\\\",\\\"status\\\",\\\"exitDate\\\",\\\"fromLead\\\",\\\"source\\\",\\\"notes\\\",\\\"billingType\\\",\\\"billingDay\\\",\\\"bundleSize\\\",\\\"bundlePrice\\\",\\\"sessionsUsed\\\",\\\"bundlePaid\\\",\\\"house_of_origin\\\",\\\"responsiblePerson\\\",\\\"serviceScope\\\",\\\"treatmentContactPhone\\\",\\\"payerName\\\",\\\"payerPhone\\\",\\\"paymentLink\\\",\\\"phone\\\",\\\"paymentStatus\\\",\\\"paymentDate\\\",\\\"nextBillingDate\\\",\\\"creditsOwed\\\",\\\"clinicalTreatmentType\\\",\\\"packageChangeDate\\\",\\\"assignedTo\\\",\\\"paymentAmountOverrides\\\",\\\"updatedAt\\\",\\\"updatedBy\\\",\\\"plannedExitDate\\\"],\\\"values\\\":[\\\"journal-client\\\",\\\"בדיקת חידוש\\\",\\\"פרטני\\\",\\\"\\\",\\\"{\\\\\\\"פרטני\\\\\\\":1}\\\",\\\"500\\\",\\\"2026-01-31\\\",\\\"פעיל\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"31\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"0500000001\\\",\\\"\\\",\\\"2026-01-31\\\",\\\"2026-02-28\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\"]}\",\"cycleDate\":\"2026-02-28\",\"patch\":{\"pricePerSession\":\"600\",\"paymentDate\":\"2026-02-25\",\"nextBillingDate\":\"2026-03-31\"},\"payment\":{\"id\":\"pay::journal-client::base::2026-02\",\"clientId\":\"journal-client\",\"clientName\":\"בדיקת חידוש\",\"billingType\":\"monthly\",\"dueDate\":\"2026-02-28\",\"amountDue\":\"600\",\"amountPaid\":\"600\",\"status\":\"paid\",\"paymentDate\":\"2026-02-25\",\"method\":\"\",\"notes\":\"תשלום לבדיקה\",\"bundleSize\":\"\",\"sessionsUsed\":\"\",\"coverageStart\":\"2026-02-28\",\"coverageEnd\":\"2026-03-27\"}}","acknowledged","{\"headers\":[\"id\",\"name\",\"serviceType\",\"location\",\"sessionsPerWeek\",\"pricePerSession\",\"startDate\",\"status\",\"exitDate\",\"fromLead\",\"source\",\"notes\",\"billingType\",\"billingDay\",\"bundleSize\",\"bundlePrice\",\"sessionsUsed\",\"bundlePaid\",\"house_of_origin\",\"responsiblePerson\",\"serviceScope\",\"treatmentContactPhone\",\"payerName\",\"payerPhone\",\"paymentLink\",\"phone\",\"paymentStatus\",\"paymentDate\",\"nextBillingDate\",\"creditsOwed\",\"clinicalTreatmentType\",\"packageChangeDate\",\"assignedTo\",\"paymentAmountOverrides\",\"updatedAt\",\"updatedBy\",\"plannedExitDate\"],\"values\":[\"journal-client\",\"בדיקת חידוש\",\"פרטני\",\"\",\"{\\\"פרטני\\\":1}\",\"500\",\"2026-01-31\",\"פעיל\",\"\",\"\",\"\",\"\",\"\",\"31\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"0500000001\",\"\",\"2026-01-31\",\"2026-02-28\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\"]}","{\"headers\":[\"id\",\"name\",\"serviceType\",\"location\",\"sessionsPerWeek\",\"pricePerSession\",\"startDate\",\"status\",\"exitDate\",\"fromLead\",\"source\",\"notes\",\"billingType\",\"billingDay\",\"bundleSize\",\"bundlePrice\",\"sessionsUsed\",\"bundlePaid\",\"house_of_origin\",\"responsiblePerson\",\"serviceScope\",\"treatmentContactPhone\",\"payerName\",\"payerPhone\",\"paymentLink\",\"phone\",\"paymentStatus\",\"paymentDate\",\"nextBillingDate\",\"creditsOwed\",\"clinicalTreatmentType\",\"packageChangeDate\",\"assignedTo\",\"paymentAmountOverrides\",\"updatedAt\",\"updatedBy\",\"plannedExitDate\"],\"values\":[\"journal-client\",\"בדיקת חידוש\",\"פרטני\",\"\",\"{\\\"פרטני\\\":1}\",\"600\",\"2026-01-31\",\"פעיל\",\"\",\"\",\"\",\"\",\"\",\"31\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"0500000001\",\"\",\"2026-02-25\",\"2026-03-31\",\"\",\"\",\"\",\"\",\"\",\"2026-10-20T10:00:00.000Z\",\"\",\"\"]}","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","","completion_seen"],["extra-fixture-operation","journal-client","2026-10-31","pay::journal-client::chg-extra-fixture-charge::once","{\"kind\":\"extra_charge\",\"version\":1,\"opId\":\"extra-fixture-operation\",\"clientId\":\"journal-client\",\"snapshot\":\"{\\\"headers\\\":[\\\"id\\\",\\\"name\\\",\\\"serviceType\\\",\\\"location\\\",\\\"sessionsPerWeek\\\",\\\"pricePerSession\\\",\\\"startDate\\\",\\\"status\\\",\\\"exitDate\\\",\\\"fromLead\\\",\\\"source\\\",\\\"notes\\\",\\\"billingType\\\",\\\"billingDay\\\",\\\"bundleSize\\\",\\\"bundlePrice\\\",\\\"sessionsUsed\\\",\\\"bundlePaid\\\",\\\"house_of_origin\\\",\\\"responsiblePerson\\\",\\\"serviceScope\\\",\\\"treatmentContactPhone\\\",\\\"payerName\\\",\\\"payerPhone\\\",\\\"paymentLink\\\",\\\"phone\\\",\\\"paymentStatus\\\",\\\"paymentDate\\\",\\\"nextBillingDate\\\",\\\"creditsOwed\\\",\\\"clinicalTreatmentType\\\",\\\"packageChangeDate\\\",\\\"assignedTo\\\",\\\"paymentAmountOverrides\\\",\\\"updatedAt\\\",\\\"updatedBy\\\",\\\"plannedExitDate\\\"],\\\"values\\\":[\\\"journal-client\\\",\\\"בדיקת חידוש\\\",\\\"פרטני\\\",\\\"\\\",\\\"{\\\\\\\"פרטני\\\\\\\":1}\\\",\\\"500\\\",\\\"2026-01-31\\\",\\\"פעיל\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"31\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"0500000001\\\",\\\"\\\",\\\"2026-01-31\\\",\\\"2026-02-28\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\",\\\"\\\"]}\",\"cycleDate\":\"2026-10-31\",\"chargeHeaders\":[\"id\",\"clientId\",\"description\",\"amount\",\"billingType\",\"chargeDate\",\"billingDay\",\"active\",\"notes\",\"created\",\"treatmentType\",\"frequencyPerWeek\"],\"paymentHeaders\":[\"id\",\"clientId\",\"clientName\",\"billingType\",\"dueDate\",\"amountDue\",\"amountPaid\",\"status\",\"paymentDate\",\"method\",\"notes\",\"bundleSize\",\"sessionsUsed\",\"coverageStart\",\"coverageEnd\"],\"charge\":{\"id\":\"extra-fixture-charge\",\"clientId\":\"journal-client\",\"description\":\"טיפול לבדיקה\",\"amount\":\"500\",\"billingType\":\"one_time\",\"chargeDate\":\"2026-09-01\",\"billingDay\":\"\",\"active\":\"true\",\"notes\":\"בדיקה בלבד\",\"created\":\"2026-10-31\",\"treatmentType\":\"פרטני CBT\",\"frequencyPerWeek\":\"\"},\"payment\":{\"id\":\"pay::journal-client::chg-extra-fixture-charge::once\",\"clientId\":\"journal-client\",\"clientName\":\"בדיקת חידוש\",\"billingType\":\"extra\",\"dueDate\":\"2026-10-31\",\"amountDue\":\"500\",\"amountPaid\":\"500\",\"status\":\"paid\",\"paymentDate\":\"2026-10-31\",\"method\":\"\",\"notes\":\"\",\"bundleSize\":\"0\",\"sessionsUsed\":\"0\",\"coverageStart\":\"2026-10-31\",\"coverageEnd\":\"2026-11-29\"}}","acknowledged","{\"headers\":[\"id\",\"name\",\"serviceType\",\"location\",\"sessionsPerWeek\",\"pricePerSession\",\"startDate\",\"status\",\"exitDate\",\"fromLead\",\"source\",\"notes\",\"billingType\",\"billingDay\",\"bundleSize\",\"bundlePrice\",\"sessionsUsed\",\"bundlePaid\",\"house_of_origin\",\"responsiblePerson\",\"serviceScope\",\"treatmentContactPhone\",\"payerName\",\"payerPhone\",\"paymentLink\",\"phone\",\"paymentStatus\",\"paymentDate\",\"nextBillingDate\",\"creditsOwed\",\"clinicalTreatmentType\",\"packageChangeDate\",\"assignedTo\",\"paymentAmountOverrides\",\"updatedAt\",\"updatedBy\",\"plannedExitDate\"],\"values\":[\"journal-client\",\"בדיקת חידוש\",\"פרטני\",\"\",\"{\\\"פרטני\\\":1}\",\"500\",\"2026-01-31\",\"פעיל\",\"\",\"\",\"\",\"\",\"\",\"31\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"0500000001\",\"\",\"2026-01-31\",\"2026-02-28\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\"]}","{\"headers\":[\"id\",\"name\",\"serviceType\",\"location\",\"sessionsPerWeek\",\"pricePerSession\",\"startDate\",\"status\",\"exitDate\",\"fromLead\",\"source\",\"notes\",\"billingType\",\"billingDay\",\"bundleSize\",\"bundlePrice\",\"sessionsUsed\",\"bundlePaid\",\"house_of_origin\",\"responsiblePerson\",\"serviceScope\",\"treatmentContactPhone\",\"payerName\",\"payerPhone\",\"paymentLink\",\"phone\",\"paymentStatus\",\"paymentDate\",\"nextBillingDate\",\"creditsOwed\",\"clinicalTreatmentType\",\"packageChangeDate\",\"assignedTo\",\"paymentAmountOverrides\",\"updatedAt\",\"updatedBy\",\"plannedExitDate\"],\"values\":[\"journal-client\",\"בדיקת חידוש\",\"פרטני\",\"\",\"{\\\"פרטני\\\":1}\",\"500\",\"2026-01-31\",\"פעיל\",\"\",\"\",\"\",\"\",\"\",\"31\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"0500000001\",\"\",\"2026-01-31\",\"2026-02-28\",\"\",\"\",\"\",\"\",\"\",\"\",\"\",\"\"]}","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","fixture-editor","completion_seen"]],"Payments":[["id","clientId","clientName","billingType","dueDate","amountDue","amountPaid","status","paymentDate","method","notes","bundleSize","sessionsUsed","coverageStart","coverageEnd"],["pay::journal-client::base::2026-02","journal-client","בדיקת חידוש","monthly","2026-02-28",600,600,"paid","2026-02-25","","תשלום לבדיקה","","","2026-02-28","2026-03-27"],["pay::journal-client::chg-extra-fixture-charge::once","journal-client","בדיקת חידוש","extra","2026-10-31",500,500,"paid","2026-10-31","","",0,0,"2026-10-31","2026-11-29"]],"ClientCharges":[["id","clientId","description","amount","billingType","chargeDate","billingDay","active","notes","created","treatmentType","frequencyPerWeek"],["extra-fixture-charge","journal-client","טיפול לבדיקה",500,"one_time","2026-09-01","","true","בדיקה בלבד","2026-10-31","פרטני CBT",""]],"Settings":[["key","value"],["drill","synthetic-only"]],"TherapistRates":[["name","flatRate","intakeRate","followupRate"],["מעיין דלומי",777,"",""]],"SessionLog":[["sessionId","phone","patientName","clientId","therapist","clinicalTreatmentType","billingType","date","outcome","therapistPay","clientSessionValue","sessionStatus","matchStatus","recordedAt","creditStatus","forwardedToPayroll"],["drill-cancelled-session","0500000099","בדיקת שחזור סינתטית","drill-session-client","מעיין דלומי","פרטני CBT","פרטני CBT","2026-10-19","therapist_cancelled",0,500,"credited","matched","2026-10-20T10:00:00.000Z","credit_added",""],["drill-forwarded-session","0500000099","בדיקת שחזור סינתטית","drill-session-client","מעיין דלומי","פרטני CBT","פרטני CBT","2026-10-19","happened",777,500,"consumed","matched","2026-10-20T10:00:00.000Z","within_quota","2026-10"]],"PackageCatalog":[["id","key","version","epoch","family","tier","unit","sessions","sessionMinutes","allowedMonths","pricePerSessionAgorot","priceTotalAgorot","monthlyPriceAgorot","priceMinAgorot","priceMaxAgorot","vatBasis","vatRateBp","active","sortOrder","sourceRef","validFromIso","createdAtIso","createdBy"],["day_track_basic@v1","day_track_basic",1,1,"day_track","basic","per_month",0,0,"1","","",1500000,"","","inclusive",1800,1,10,"PDF p3: מסלול בסיסי, 3 days/week, 15,000 ₪ per month","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["day_track_extended@v1","day_track_extended",1,1,"day_track","extended","per_month",0,0,"1","","",1800000,"","","inclusive",1800,1,20,"PDF p3: מסלול מורחב, 5 days/week, 18,000 ₪ per month","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["emdr_core@v1","emdr_core",1,1,"emdr","core","per_session_pack",4,60,"",85000,"","","","","inclusive",1800,1,30,"PDF p5: EMDR Core, 4 sessions, 3,400 ₪ total, 850 ₪ per session","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["emdr_standard@v1","emdr_standard",1,1,"emdr","standard","per_session_pack",8,60,"",85000,"","","","","inclusive",1800,1,40,"PDF p5: EMDR Standard, 8 sessions, 6,800 ₪ total","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["emdr_complex@v1","emdr_complex",1,1,"emdr","complex","per_session_pack",16,60,"",85000,"","","","","inclusive",1800,1,50,"PDF p5: EMDR Complex, 16 sessions, 13,600 ₪ total","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["emdr_single@v1","emdr_single",1,1,"emdr","single","per_session_pack",1,60,"",85000,"","","","","inclusive",1800,1,60,"PDF p5: single EMDR session 850 ₪ (30-day conversion credit NOT modelled)","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["cbt_core@v1","cbt_core",1,1,"cbt","core","per_session_pack",6,50,"",50000,"","","","","inclusive",1800,1,70,"PDF p6: CBT Core, 6 sessions, 3,000 ₪ total, 500 ₪ per session","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["cbt_standard@v1","cbt_standard",1,1,"cbt","standard","per_session_pack",12,50,"",50000,"","","","","inclusive",1800,1,80,"PDF p6: CBT Standard, 12 sessions, 6,000 ₪ total","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["cbt_complex@v1","cbt_complex",1,1,"cbt","complex","per_session_pack",20,50,"",50000,"","","","","inclusive",1800,1,90,"PDF p6: CBT Complex, 20 sessions, 10,000 ₪ total","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["cbt_single@v1","cbt_single",1,1,"cbt","single","per_session_pack",1,50,"",50000,"","","","","inclusive",1800,1,100,"PDF p6: single CBT session 500 ₪ (30-day conversion credit NOT modelled)","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["emdr_cbt_combined@v1","emdr_cbt_combined",1,1,"emdr_cbt","combined","flat",12,0,"","",850000,"","","","inclusive",1800,1,110,"PDF p6: combined EMDR+CBT, 12 sessions, flat 8,500 ₪ (not 12 x a per-session rate)","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["continuation_monthly@v1","continuation_monthly",1,1,"continuation","monthly","per_month",4,50,"1","","",200000,"","","inclusive",1800,1,120,"PDF p7: טיפולי המשך, 4 sessions per month, 2,000 ₪ per month, month-to-month","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["psychiatric_consult@v1","psychiatric_consult",1,1,"psychiatric","consult","per_session_pack",1,0,"",90000,"","","","","inclusive",1800,1,130,"PDF p7: ייעוץ פסיכיאטרי 900 ₪ per meeting (distinct from the 1,100 ₪ מעקב פסיכיאטרי billing price)","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["psychiatric_diagnosis@v1","psychiatric_diagnosis",1,1,"psychiatric","diagnosis","flat",1,0,"","",250000,"","","","inclusive",1800,1,140,"PDF p7: אבחון פסיכיאטרי, one-time 2,500 ₪ incl. written report (distinct from the 2,300 ₪ אינטייק billing price)","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"],["solo_housing@v1","solo_housing",1,1,"solo_housing","range","per_month_range",0,0,"3","","","",800000,1000000,"inclusive",1800,1,150,"PDF p8: Solo, 8,000–10,000 ₪ per month, 3 months (extension by clinical judgment). Vered must select the monthly price","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"]],"PackageRequests":[["id","payloadHash","status","revision","requesterKey","patientName","patientPhone","packageKey","months","catalogRowId","catalogEpoch","selectedMonthlyAgorot","quoteSnapshot","adjustedTotalAgorot","adjustReason","adjustLog","approvedTotalAgorot","approvedSnapshot","approvedAtIso","approvedBy","attachedType","attachedId","attachedAtIso","attachedBy","opLog","createdAtIso","updatedAt","updatedBy"],["11111111-2222-4333-8444-555555555555","8b679c3660133133c7070c6a24a55f5bcc699d64a3668dcbeca61b25c46de388","priced",2,"oren","בדיקת שחזור סינתטית","0500000099","emdr_core",0,"emdr_core@v1",1,"","{\"rowId\":\"emdr_core@v1\",\"key\":\"emdr_core\",\"version\":1,\"epoch\":1,\"family\":\"emdr\",\"tier\":\"core\",\"unit\":\"per_session_pack\",\"sessions\":4,\"months\":0,\"monthlyAgorot\":null,\"commitmentMonths\":null,\"grossAgorot\":340000,\"netAgorot\":288136,\"vatAgorot\":51864,\"vatBasis\":\"inclusive\",\"vatRateBp\":1800,\"needsSelection\":false,\"computedAtIso\":\"2026-10-20T10:00:00.000Z\"}","","","[]",340000,"{\"rowId\":\"emdr_core@v1\",\"key\":\"emdr_core\",\"version\":1,\"epoch\":1,\"family\":\"emdr\",\"tier\":\"core\",\"unit\":\"per_session_pack\",\"sessions\":4,\"months\":0,\"monthlyAgorot\":null,\"commitmentMonths\":null,\"grossAgorot\":340000,\"netAgorot\":288136,\"vatAgorot\":51864,\"vatBasis\":\"inclusive\",\"vatRateBp\":1800,\"needsSelection\":false,\"computedAtIso\":\"2026-10-20T10:00:00.000Z\",\"adjusted\":false,\"finalGrossAgorot\":340000,\"finalNetAgorot\":288136,\"finalVatAgorot\":51864,\"approvedAtIso\":\"2026-10-20T10:00:00.000Z\"}","2026-10-20T10:00:00.000Z","ורד","","","","","[\"99999999-2222-4333-8444-555555555555\"]","2026-10-20T10:00:00.000Z","2026-10-20T10:00:00.000Z","ורד"]],"AuditLog":[["timestamp","action","fn","rowKey","name","details","literal","leadingZero","flag","amount","instant"],["2026-10-20","drill","fixture","synthetic","synthetic","not production","=1+1","000123",true,777.25,{"drillDate":"2026-10-20T10:11:12.000Z"}]]},"event":{"sessionId":"drill-cancelled-session","phone":"0500000099","patientName":"בדיקת שחזור סינתטית","therapist":"מעיין דלומי","clinicalTreatmentType":"פרטני CBT","date":"2026-10-19","outcome":"therapist_cancelled","secret":"synthetic-drill-session-secret-not-a-credential"},"paidEvent":{"sessionId":"drill-forwarded-session","phone":"0500000099","patientName":"בדיקת שחזור סינתטית","therapist":"מעיין דלומי","clinicalTreatmentType":"פרטני CBT","date":"2026-10-19","outcome":"happened","secret":"synthetic-drill-session-secret-not-a-credential"},"renewalId":"renewal-fixture-0001","extraId":"extra-fixture-operation"};
  var phaseStartedAt = Date.now();
  var nativeSheets = SpreadsheetApp, nativeProps = PropertiesService.getScriptProperties();
  var stateKey = 'OP03_DRILL_STATE', prefix = 'OP03_DRILL_FIXTURE_';
  var state, books, currentBook, lock = LockService.getScriptLock();
  var stages = { prepare: '', capture: 'prepared', restore: 'captured', verify: 'restored', manual: 'verified' };
  if (!Object.prototype.hasOwnProperty.call(stages, phase)) throw new Error('Unknown drill phase');
  lock.waitLock(30000);
  try {
    var raw = nativeProps.getProperty(stateKey);
    state = raw ? JSON.parse(raw) : null;
    if (phase === 'prepare') {
      if (state) throw new Error('Drill already exists; preserve its evidence');
      // Names only: do not inspect any values from a pre-existing project.
      if (nativeProps.getKeys().length) throw new Error('Fresh standalone test project required');
      state = { tag: Utilities.getUuid(), phase: '', ids: {}, running: true,
        sourceHash: metadata.sourceCodeSHA256, helperHash: metadata.helperSHA256, drillHash: metadata.drillDefinitionSHA256,
        day: Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd') };
    } else {
      if (!state || state.running || state.failed || state.phase !== stages[phase] ||
          state.sourceHash !== metadata.sourceCodeSHA256 || state.helperHash !== metadata.helperSHA256 ||
          state.drillHash !== metadata.drillDefinitionSHA256) {
        throw new Error('Drill state, order or source hash mismatch');
      }
      state.running = true;
    }
    nativeProps.setProperty(stateKey, JSON.stringify(state));
  } finally { lock.releaseLock(); }

  function name(role) { return 'OP03 SYNTHETIC NOT PRODUCTION ' + state.tag + ' ' + role; }
  function loadBooks() {
    var seen = {}, result = {};
    ['source', 'backup', 'target'].forEach(function (role) {
      var id = state.ids[role];
      if (!id || seen[id]) throw new Error('Invalid isolated workbook IDs');
      seen[id] = true;
      var ss = nativeSheets.openById(id);
      if (ss.getName() !== name(role)) throw new Error('Isolated workbook name mismatch');
      result[role] = ss;
    });
    return result;
  }
  function saveState() { nativeProps.setProperty(stateKey, JSON.stringify(state)); }
  function report(result, detail) {
    if (!books || !books.backup) return;
    var sh = books.backup.getSheetByName('_DrillReport');
    if (!sh) throw new Error('Drill report missing');
    var row = [new Date().toISOString(), phase, result, detail,
      metadata.sourceCodeSHA256, metadata.helperSHA256, metadata.drillDefinitionSHA256, Date.now() - phaseStartedAt];
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setNumberFormat('@')
      .setValues([row.map(function (v) { return "'" + String(v); })]);
  }
  var facade = {
    getActiveSpreadsheet: function () { return currentBook; },
    openById: function (id) {
      for (var role in books) if (books[role].getId() === id) return books[role];
      throw new Error('Workbook outside isolated drill');
    },
    flush: function () { nativeSheets.flush(); }
  };
  // Production property names are scoped to this drill, including its hold.
  var propertyFacade = { getScriptProperties: function () { return {
    getProperty: function (k) { return nativeProps.getProperty(prefix + k); },
    setProperty: function (k, v) { nativeProps.setProperty(prefix + k, String(v)); },
    deleteProperty: function (k) { nativeProps.deleteProperty(prefix + k); }
  }; } };

  try {
    if (phase === 'prepare') {
      books = {};
      ['source', 'backup', 'target'].forEach(function (role) {
        books[role] = nativeSheets.create(name(role));
        state.ids[role] = books[role].getId(); saveState();
      });
      books.backup.getSheets()[0].setName('_DrillReport').getRange(1, 1, 1, 8)
        .setValues([['at', 'phase', 'result', 'detail', 'sourceSHA256', 'helperSHA256', 'drillSHA256', 'durationMs']]);
    } else books = loadBooks();
    currentBook = phase === 'verify' ? books.target : books.source;
    var result = (function (SpreadsheetApp, PropertiesService) {
      // Exact production function bodies and derived constants, source-hashed.
var AUDIT_LOG_HEADERS = ["timestamp","action","fn","rowKey","name","details"];

var AUDIT_LOG_SHEET = "AuditLog";

var BILLING_PRICES = {"פרטני":500,"פרטני CBT":500,"פרטני EMDR":500,"פסיכודינמי":500,"פסיכותרפי ממוקד טראומה":500,"עיסוי טיפולי":500,"טיפול ממוקד התמכרויות":500,"טיפול אינטגרטיבי":500,"מעקב פסיכיאטרי":1100,"אינטייק":2300,"קבוצה":0,"טיפול משפחתי":600};

var CHARGES_HEADERS = ["id","clientId","description","amount","billingType","chargeDate","billingDay","active","notes","created","treatmentType","frequencyPerWeek"];

var CLIENTS_DATA_VERSION_PROP = "CLIENTS_DATA_VERSION";

var CLIENTS_HEADERS = ["id","name","serviceType","location","sessionsPerWeek","pricePerSession","startDate","status","exitDate","fromLead","source","notes","billingType","billingDay","bundleSize","bundlePrice","sessionsUsed","bundlePaid","house_of_origin","responsiblePerson","serviceScope","treatmentContactPhone","payerName","payerPhone","paymentLink","phone","paymentStatus","paymentDate","nextBillingDate","creditsOwed","clinicalTreatmentType","packageChangeDate","assignedTo","paymentAmountOverrides","updatedAt","updatedBy","plannedExitDate"];

var CLIENTS_REMOVED_HEADERS = ["id","name","serviceType","location","sessionsPerWeek","pricePerSession","startDate","status","exitDate","fromLead","source","notes","billingType","billingDay","bundleSize","bundlePrice","sessionsUsed","bundlePaid","house_of_origin","responsiblePerson","serviceScope","treatmentContactPhone","payerName","payerPhone","paymentLink","phone","paymentStatus","paymentDate","nextBillingDate","creditsOwed","clinicalTreatmentType","packageChangeDate","assignedTo","paymentAmountOverrides","removedAt","removedVia","restoredAt","updatedAt","updatedBy","plannedExitDate"];

var CLINICAL_TO_BILLING = {"פרטני כללי":"פרטני","פרטני CBT":"פרטני CBT","פרטני EMDR":"פרטני EMDR","קבוצה":"קבוצה","טיפול משפחתי":"טיפול משפחתי","מעקב פסיכיאטרי":"מעקב פסיכיאטרי","ליווי יומי בקהילה":"ליווי יומי בקהילה","פסיכודינמי":"פסיכודינמי","פסיכותרפי ממוקד טראומה":"פסיכותרפי ממוקד טראומה","עיסוי טיפולי":"עיסוי טיפולי","טיפול ממוקד התמכרויות":"טיפול ממוקד התמכרויות","טיפול אינטגרטיבי":"טיפול אינטגרטיבי"};

var CONTINUATION_HEADERS = ["key","name","house","entryDate","meetingDate","outcome","outcomeDate","note","updatedAt"];

var CONTINUATION_SHEET = "מסלול המשך";

var COVERAGE_MAX_DAYS = 366;

var CREDIT_COLUMNS = ["id","clientId","clientName","creditType","allocationMonth","calculatedAmount","amount","overrideReason","reason","approvedBy","decidedDate","payoutDate","status","paidDate","method","notes","basis","createdAt","createdBy","updatedAt","updatedBy"];

var DAY_CENTER_BILLING = "ליווי יומי בקהילה";

var DAY_CENTER_MONTHLY_BY_FREQ = {"3":15000,"5":18000};

var EXTRA_SESSION_HEADERS = ["id","phone","patientName","treatmentType","therapist","monthKey","quota","used","requestedBy","note","requestedAt","status","approvedBy","approvedAt"];

var FINANCIAL_OP_HEADERS = ["id","clientId","cycleDate","paymentId","intent","state","before","after","createdAt","updatedAt","updatedBy","resolution"];

var FINANCIAL_OP_STATES = ["prepared","client_writing","client_done","payment_writing","done","acknowledged","cancelled","review","reviewed","charge_writing","charge_done"];

var GROUP_BILLING = "קבוצה";

var INTEGRITY_APPROVED_MANUAL_POLICY_SHA256 = "";

var INTEGRITY_DATA_SNAPSHOT_RE = /^outpatient-(?:(?:leads|leads-removed|clients-removed|payments|charges|credits|financial-ops|session-log|therapist-rates|settings|stop-flags|extra-sessions|continuation|stop-alerts|audit-log|repair-plan|package-catalog|package-requests|recovery-meta|other-[a-f0-9]{64}|manifest)-)?(\d{4})-(\d{2})-(\d{2})$/;

var INTEGRITY_SNAPSHOT_PREFIX = "outpatient-";

var LEADS_HEADERS = ["id","name","phone","serviceType","location","note","stage","sessionsPerWeek","pricePerSession","startDate","created","introDateTime","house_of_origin","not_relevant_reason","not_relevant_note","assignedTo","updatedAt","updatedBy"];

var PACKAGE_CATALOG_HEADERS = ["id","key","version","epoch","family","tier","unit","sessions","sessionMinutes","allowedMonths","pricePerSessionAgorot","priceTotalAgorot","monthlyPriceAgorot","priceMinAgorot","priceMaxAgorot","vatBasis","vatRateBp","active","sortOrder","sourceRef","validFromIso","createdAtIso","createdBy"];

var PACKAGE_REQUEST_HEADERS = ["id","payloadHash","status","revision","requesterKey","patientName","patientPhone","packageKey","months","catalogRowId","catalogEpoch","selectedMonthlyAgorot","quoteSnapshot","adjustedTotalAgorot","adjustReason","adjustLog","approvedTotalAgorot","approvedSnapshot","approvedAtIso","approvedBy","attachedType","attachedId","attachedAtIso","attachedBy","opLog","createdAtIso","updatedAt","updatedBy"];

var PACKAGE_TEXT_COLUMNS = {"payloadHash":true,"validFromIso":true,"createdAtIso":true,"approvedAtIso":true,"attachedAtIso":true,"allowedMonths":true};

var PAYMENTS_HEADERS = ["id","clientId","clientName","billingType","dueDate","amountDue","amountPaid","status","paymentDate","method","notes","bundleSize","sessionsUsed","coverageStart","coverageEnd"];

var PAYMENT_TEXT_COLUMNS = ["coverageStart","coverageEnd"];

var PHONE_COLUMNS = {"phone":true,"treatmentContactPhone":true,"payerPhone":true,"patientPhone":true};

var PSYCHIATRIST_RATES = {"ד״ר שפרינץ":{"אינטייק":900,"מעקב פסיכיאטרי":700},"ד״ר נטליה":{"אינטייק":900,"מעקב פסיכיאטרי":700},"ד״ר דנגור":{"אינטייק":900,"מעקב פסיכיאטרי":700}};

var REMOVED_LEADS_HEADERS = ["id","name","phone","serviceType","location","note","stage","sessionsPerWeek","pricePerSession","startDate","created","introDateTime","house_of_origin","not_relevant_reason","not_relevant_note","removedAt","originSheet","assignedTo","updatedAt","updatedBy"];

var REPAIR_PLAN_HEADERS = ["sheet","row","column","newValue","action","approved","oldValue","source"];

var REPAIR_PLAN_SHEET = "RepairPlan";

var SESSION_LOG_HEADERS = ["sessionId","phone","patientName","clientId","therapist","clinicalTreatmentType","billingType","date","outcome","therapistPay","clientSessionValue","sessionStatus","matchStatus","recordedAt","creditStatus","forwardedToPayroll"];

var SESSION_STATUS_BY_OUTCOME = {"happened":"consumed","therapist_cancelled":"credited","patient_no_show":"forfeited"};

var SETTINGS_HEADERS = ["key","value"];

var STAMP_COLUMNS = {"updatedAt":true,"updatedBy":true};

var STOP_ALERTS_HEADERS = ["id","clientId","clientName","createdAt","createdBy","status","readAt","note","reason","type","cancelledAt"];

var STOP_ALERTS_SHEET = "התראות עצירת טיפול";

var STOP_FLAGS_HEADERS = ["id","phone","name","clientId","reportedBy","reportedAt","note","status","resolvedBy","resolvedAt"];

var THERAPIST_FLAT_RATES = {"מעיין דלומי":250,"תמר גנץ":250,"אורן כביר":250,"אביב מלכה":250,"רמי":250,"כנרת":250,"הילה":250,"עידו בוזגלו":250,"אלה":250,"שירן":250,"דנה":250,"יפעת":250,"איתן דשה":250,"דליה מלמד":230,"נועה זיפמן":210,"אסתר":180};

var THERAPIST_RATES_HEADERS = ["name","flatRate","intakeRate","followupRate"];

var THERAPIST_RATES_SHEET = "TherapistRates";

function _applyExtraCharge(payload) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try {
    if (PropertiesService.getScriptProperties().getProperty('OUTPATIENT_RECOVERY_HOLD')) throw new Error('recovery_pending');
    var journal = _finJournal(), op = journal.ops.filter(function (r) { return r.id === String(payload.opId || ''); })[0];
    if (!op) return { ok: false, error: 'operation_not_found' };
    var i = JSON.parse(op.intent), user = _requestUser(payload);
    if (i.kind !== 'extra_charge') return { ok: false, error: 'operation_kind_mismatch' };
    if (!_finActive(op) || op.state === 'review') return { ok: true, operation: _finSummary(op) };
    function review(why) { _finWrite(journal, op, 'review', user, why); return { ok: true, operation: _finSummary(op) }; }
    var view = _extraReadback(op);
    if (!view.client || _finSnapshot(view.client, JSON.parse(op.before).headers) !== op.before) return review('extra_client_changed');
    if (op.state === 'prepared') {
      if (!_extraObservationMatches(op, view, false)) return review('extra_effect_appeared');
      _finWrite(journal, op, 'charge_writing', user);
      _extraAppend('ClientCharges', CHARGES_HEADERS, i.charge, ['amount', 'billingDay', 'frequencyPerWeek']);
      view = _extraReadback(op);
    }
    if (!_extraSame(view.charges, i.charge, i.chargeHeaders)) return review('extra_charge_write_uncertain_or_changed');
    if (op.state === 'charge_writing') _finWrite(journal, op, 'charge_done', user);
    if (op.state === 'charge_done') {
      if (view.payments.length) return review('extra_payment_appeared');
      if (i.payment) {
        _finWrite(journal, op, 'payment_writing', user);
        _extraAppend('Payments', PAYMENTS_HEADERS, i.payment, ['amountDue', 'amountPaid', 'bundleSize', 'sessionsUsed']);
        view = _extraReadback(op);
      }
    }
    if (!_extraObservationMatches(op, view, true)) return review('extra_payment_write_uncertain_or_changed');
    if (op.state !== 'done') _finWrite(journal, op, 'done', user);
    return { ok: true, operation: _finSummary(op) };
  } finally { lock.releaseLock(); }
}

function _applyRenewal(payload) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, error: 'busy' };
  try {
    if (PropertiesService.getScriptProperties().getProperty('OUTPATIENT_RECOVERY_HOLD')) throw new Error('recovery_pending');
    var journal = _finJournal(), op = journal.ops.filter(function (r) { return r.id === String(payload.opId || ''); })[0];
    if (!op) return { ok: false, error: 'operation_not_found' };
    if (JSON.parse(op.intent).kind) return { ok: false, error: 'operation_kind_mismatch' };
    if (op.state === 'acknowledged' || op.state === 'cancelled' || op.state === 'reviewed' || op.state === 'review') return { ok: true, operation: _finSummary(op) };
    var user = _requestUser(payload), c;
    function review(why) { _finWrite(journal, op, 'review', user, why); return { ok: true, operation: _finSummary(op) }; }
    try { c = _finClient(op.clientId); } catch (_) { return review('client_missing_or_duplicate'); }
    var storedHeaders = JSON.parse(op.before).headers;
    var current = _finSnapshot(c.client, storedHeaders), p = JSON.parse(op.intent).payment;
    var payments = _finPayments(op.paymentId, op.clientId, op.cycleDate);
    if (op.state === 'prepared') {
      if (current !== op.before || payments.length) return review('source_changed_before_apply');
      _finWrite(journal, op, 'client_writing', user);
      // One row, fixed expected stamp, no whole-sheet rewrite. Text-forced first.
      var beforeCells = JSON.parse(op.before).values, afterCells = JSON.parse(op.after).values;
      var clientValues = CLIENTS_HEADERS.map(function (h, i) {
        // A later append-only schema release must not invalidate this intent or
        // erase a new column. Its fields were not part of this renewal's patch.
        if (i >= storedHeaders.length || beforeCells[i] === afterCells[i]) return c.client[h] == null ? '' : c.client[h];
        if (h === 'pricePerSession') return Number(afterCells[i]);
        c.sheet.getRange(c.row, i + 1).setNumberFormat('@');
        return afterCells[i];
      });
      c.sheet.getRange(c.row, 1, 1, CLIENTS_HEADERS.length).setValues([clientValues]);
      _bumpDataVersion();
      current = _finSnapshot(_finClient(op.clientId).client, storedHeaders);
      if (current !== op.after) return review('client_write_mismatch');
      _finWrite(journal, op, 'client_done', user);
    } else if (op.state === 'client_writing') {
      if (current !== op.after) return review('client_write_uncertain');
      _bumpDataVersion();
      _finWrite(journal, op, 'client_done', user);
    }
    if (current !== op.after) return review('client_changed_after_apply');
    if (op.state === 'client_done') {
      if (payments.length) return review('payment_appeared_before_apply');
      _finWrite(journal, op, 'payment_writing', user);
      var sh = _ensurePaymentsSheet(), row = sh.getLastRow() + 1;
      var numericPayment = ['amountDue', 'amountPaid', 'bundleSize', 'sessionsUsed'];
      var paymentValues = PAYMENTS_HEADERS.map(function (h, i) {
        if (numericPayment.indexOf(h) >= 0) return p[h] === '' ? '' : Number(p[h]);
        sh.getRange(row, i + 1).setNumberFormat('@');
        return p[h];
      });
      sh.getRange(row, 1, 1, PAYMENTS_HEADERS.length).setValues([paymentValues]);
      payments = _finPayments(op.paymentId, op.clientId, op.cycleDate);
    }
    if (payments.length !== 1 || JSON.stringify(_finRow(payments[0], PAYMENTS_HEADERS)) !== JSON.stringify(_finRow(p, PAYMENTS_HEADERS))) {
      return review('payment_write_uncertain_or_changed');
    }
    if (op.state !== 'done') _finWrite(journal, op, 'done', user);
    return { ok: true, operation: _finSummary(op) };
  } finally { lock.releaseLock(); }
}

function _asISODate(v) {
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd');
  }
  var s = String(v == null ? '' : v).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? (m[1] + '-' + m[2] + '-' + m[3]) : '';
}

function _billingPrice(billingType, freqPerWeek) {
  var key = String(billingType == null ? '' : billingType).trim();
  if (_isDayCenterBilling(key)) {
    if (freqPerWeek === undefined || freqPerWeek === null || freqPerWeek === '') {
      throw new Error('ליווי יומי בקהילה requires frequencyPerWeek (3 or 5)');
    }
    var freq = Number(freqPerWeek);
    if (!_hasOwn(DAY_CENTER_MONTHLY_BY_FREQ, freq)) {
      throw new Error('Unsupported ליווי יומי בקהילה frequency: ' + freqPerWeek + ' (expected 3 or 5)');
    }
    return DAY_CENTER_MONTHLY_BY_FREQ[freq];
  }
  if (!_hasOwn(BILLING_PRICES, key)) {
    throw new Error('Unknown billing type: "' + key + '"');
  }
  return BILLING_PRICES[key];
}

function _bumpDataVersion() {
  var next = _readDataVersion() + 1;
  PropertiesService.getScriptProperties().setProperty(CLIENTS_DATA_VERSION_PROP, String(next));
  return next;
}

function _clampDayIso(y, m, day) {
  var last = new Date(y, m, 0).getDate();
  var d = day > last ? last : day;
  return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
}

function _clinicalToBilling(clinicalType) {
  var key = String(clinicalType == null ? '' : clinicalType).trim();
  if (!Object.prototype.hasOwnProperty.call(CLINICAL_TO_BILLING, key)) {
    throw new Error('Unknown clinical treatment type: "' + key + '"');
  }
  return CLINICAL_TO_BILLING[key];
}

function _computeSessionPay(outcome, therapist, clinicalTreatmentType, billingType) {
  if (outcome === 'therapist_cancelled') return 0; // never delivered -> never paid
  if (billingType === GROUP_BILLING) return 0;      // group -> 0 pay
  return _therapistPay(therapist, clinicalTreatmentType); // showed up -> paid
}

function _computeSessionValue(billingType, freqPerWeek) {
  if (_isDayCenterBilling(billingType) &&
      (freqPerWeek === undefined || freqPerWeek === null || freqPerWeek === '')) {
    return null;
  }
  return _billingPrice(billingType, freqPerWeek);
}

function _coverageDateISO(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return null;
    return Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd');
  }
  if (typeof v !== 'string') return null;   // a number/boolean/object is not a date
  var t = v.trim();
  if (!t) return '';
  var m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    return _isRealCalendarDate(Number(m[1]), Number(m[2]), Number(m[3])) ? t : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(t)) return null;
  var ts = new Date(t);
  if (isNaN(ts.getTime())) return null;
  return Utilities.formatDate(ts, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd');
}

function _coveragePeriodError(startRaw, endRaw) {
  /* PRESENCE first, then validity — the same order as the client. Deciding
   * "half-filled" from the PARSED value would report '' + 'garbage' as a
   * malformed date here and as a missing date there, and the two messages must
   * match (parity is asserted in test/payment-coverage-period.test.js). */
  var rawS = (startRaw === null || startRaw === undefined) ? '' : String(startRaw).trim();
  var rawE = (endRaw === null || endRaw === undefined) ? '' : String(endRaw).trim();
  if (!rawS && !rawE) return '';
  if (!rawS || !rawE) return 'יש למלא גם תאריך התחלה וגם תאריך סיום לתקופת הכיסוי';
  var s = _coverageDateISO(startRaw), e = _coverageDateISO(endRaw);
  if (!s || !e) return 'תאריך לא תקין בתקופת הכיסוי';
  // Local-midnight Dates from the PARTS — never Date.parse, which reads a bare
  // ISO date as UTC midnight.
  var sp = s.split('-'), ep = e.split('-');
  var ds = new Date(Number(sp[0]), Number(sp[1]) - 1, Number(sp[2]));
  var de = new Date(Number(ep[0]), Number(ep[1]) - 1, Number(ep[2]));
  if (isNaN(ds.getTime()) || isNaN(de.getTime())) return 'תאריך לא תקין בתקופת הכיסוי';
  if (de.getTime() < ds.getTime()) return 'תאריך הסיום מוקדם מתאריך ההתחלה';
  // Math.round absorbs the ±1h a DST switch injects between local midnights.
  var days = Math.round((de.getTime() - ds.getTime()) / 86400000) + 1;
  if (days > COVERAGE_MAX_DAYS) {
    return 'תקופת כיסוי ארוכה מדי (' + days + ' ימים, המקסימום ' + COVERAGE_MAX_DAYS + ')';
  }
  return '';
}

function _ensurePaymentsSheet() {
  var sh = _ensureSheet('Payments', PAYMENTS_HEADERS);
  var maxRows = sh.getMaxRows();
  if (maxRows >= 2) {
    for (var i = 0; i < PAYMENT_TEXT_COLUMNS.length; i++) {
      var c = PAYMENTS_HEADERS.indexOf(PAYMENT_TEXT_COLUMNS[i]);
      if (c >= 0) sh.getRange(2, c + 1, maxRows - 1, 1).setNumberFormat('@');
    }
  }
  return sh;
}

function _ensureSheet(name, headers) {
  var ss = _ss();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    _formatPhoneColumns(sh, headers);
    return sh;
  }
  var lastCol = Math.max(sh.getLastColumn(), headers.length);
  var existing = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var needsHeader = false;
  for (var i = 0; i < headers.length; i++) {
    if (existing[i] !== headers[i]) { needsHeader = true; break; }
  }
  if (needsHeader) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  _formatPhoneColumns(sh, headers);
  return sh;
}

function _extraAppend(name, headers, obj, numeric) {
  var sh = _ensureSheet(name, headers), row = sh.getLastRow() + 1;
  var values = headers.map(function (h, n) {
    var v = obj[h] == null ? '' : obj[h];
    if (numeric.indexOf(h) >= 0) return v === '' ? '' : Number(v);
    sh.getRange(row, n + 1).setNumberFormat('@');
    return v;
  });
  sh.getRange(row, 1, 1, headers.length).setValues([values]);
}

function _extraIntent(payload, stored) {
  var ch = payload.charge || {}, p = payload.payment;
  var chargeHeaders = stored ? payload.chargeHeaders : CHARGES_HEADERS.slice();
  var paymentHeaders = stored ? payload.paymentHeaders : PAYMENTS_HEADERS.slice();
  function prefix(headers, current) {
    return Array.isArray(headers) && headers.length > 0 && headers.length <= current.length &&
      JSON.stringify(headers) === JSON.stringify(current.slice(0, headers.length));
  }
  if (!prefix(chargeHeaders, CHARGES_HEADERS) || !prefix(paymentHeaders, PAYMENTS_HEADERS)) throw new Error('extra_schema_invalid');
  var charge = {}, payment = null;
  chargeHeaders.forEach(function (h) { charge[h] = String(ch[h] == null ? '' : ch[h]); });
  if (p != null) {
    payment = {};
    paymentHeaders.forEach(function (h) { payment[h] = String(p[h] == null ? '' : p[h]); });
  }
  var intent = { kind: 'extra_charge', version: 1, opId: String(payload.opId || ''),
    clientId: String(payload.clientId || ''), snapshot: String(payload.snapshot || ''),
    cycleDate: String(payload.cycleDate || ''), chargeHeaders: chargeHeaders,
    paymentHeaders: paymentHeaders, charge: charge, payment: payment };
  if ((stored && (payload.kind !== intent.kind || payload.version !== 1)) ||
      !/^[A-Za-z0-9_-]{12,120}$/.test(intent.opId) || !intent.clientId ||
      !intent.snapshot || JSON.stringify(intent).length > 40000) throw new Error('invalid_extra_intent');
  return intent;
}

function _extraIntentV1Error(intent, client) {
  // Frozen v1 contract. Future treatment lists/limits require a new version or
  // a reservation-only policy, not retroactive changes to pending v1 history.
  var ch = intent.charge, p = intent.payment, day = intent.cycleDate;
  var types = ['פרטני', 'פרטני CBT', 'פרטני EMDR', 'קבוצה', 'טיפול משפחתי', 'ליווי יומי בקהילה', 'מעקב פסיכיאטרי'];
  function date(v) { return !!v && _coverageDateISO(v) === v; }
  function positive(v) { return isFinite(Number(v)) && Number(v) > 0 && String(Number(v)) === v; }
  function integer(v, max) { return positive(v) && Math.floor(Number(v)) === Number(v) && Number(v) <= max; }
  if (!date(day) || !/^[A-Za-z0-9_-]{6,120}$/.test(ch.id) || ch.clientId !== intent.clientId ||
      !ch.description.trim() || ch.description.length > 2000 || ch.notes.length > 10000 ||
      !positive(ch.amount) || ['one_time', 'monthly'].indexOf(ch.billingType) < 0 ||
      !date(ch.chargeDate) || ch.created !== day || ch.active !== 'true' ||
      (ch.billingDay !== '' && !integer(ch.billingDay, 31)) ||
      (ch.frequencyPerWeek && !integer(ch.frequencyPerWeek, 14)) ||
      (ch.billingType === 'one_time' && (ch.billingDay !== '' || ch.frequencyPerWeek)) ||
      (ch.treatmentType && types.indexOf(ch.treatmentType) < 0)) return 'invalid_extra_charge';
  // Preserve existing semantics: creation's optional paid record belongs to the
  // recording day/month, even if the charge start date is earlier or later.
  var coverageEnd = '';
  if (p) {
    var end = new Date(_finAddMonth(day) + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() - 1);
    coverageEnd = end.toISOString().slice(0, 10);
  }
  if (p && (p.id !== 'pay::' + intent.clientId + '::chg-' + ch.id + '::' +
      (ch.billingType === 'one_time' ? 'once' : day.slice(0, 7)) ||
      p.clientId !== intent.clientId || p.clientName !== String(client.name || '') ||
      p.billingType !== 'extra' || p.dueDate !== day || p.paymentDate !== day ||
      p.amountDue !== ch.amount || p.amountPaid !== ch.amount || p.status !== 'paid' ||
      (p.bundleSize !== '' && p.bundleSize !== '0') || (p.sessionsUsed !== '' && p.sessionsUsed !== '0') ||
      _coveragePeriodError(p.coverageStart, p.coverageEnd) ||
      p.coverageStart !== day || p.coverageEnd !== coverageEnd)) return 'invalid_extra_payment';
  return '';
}

function _extraObservationMatches(op, view, complete) {
  var i = JSON.parse(op.intent);
  if (!view.client || _finSnapshot(view.client, JSON.parse(op.before).headers) !== op.before) return false;
  return complete ? _extraSame(view.charges, i.charge, i.chargeHeaders) &&
    (i.payment ? _extraSame(view.payments, i.payment, i.paymentHeaders) : !view.payments.length) :
    !view.charges.length && !view.payments.length;
}

function _extraReadback(op) {
  var intent = JSON.parse(op.intent), client = null, clientError = '';
  try { client = _finClient(op.clientId).client; } catch (err) { clientError = String(err); }
  var charges = _extraRows('ClientCharges', CHARGES_HEADERS, intent.charge.id);
  // Observe all payments for this new charge, including a foreign-month row or
  // a row with an incorrect owner, so manual interference cannot be ignored.
  var sh = _ss().getSheetByName('Payments');
  var chargePart = '::chg-' + intent.charge.id + '::';
  var payments = sh ? _readAll(sh, PAYMENTS_HEADERS).filter(function (p) {
    return String(p.id).indexOf(chargePart) >= 0 || (op.paymentId && String(p.id) === op.paymentId);
  }) : [];
  var token = JSON.stringify({ client: client ? _finSnapshot(client) : null, clientError: clientError,
    charges: charges.map(function (c) { return _finRow(c, CHARGES_HEADERS); }),
    payments: payments.map(function (p) { return _finRow(p, PAYMENTS_HEADERS); }) });
  return { token: token, clientExists: !!client, chargeCount: charges.length, paymentCount: payments.length,
    client: client, charges: charges, payments: payments };
}

function _extraRows(name, headers, id) {
  var sh = _ss().getSheetByName(name);
  return sh ? _readAll(sh, headers).filter(function (r) { return String(r.id) === id; }) : [];
}

function _extraSame(actual, expected, headers) {
  return actual.length === 1 && JSON.stringify(_finRow(actual[0], headers)) === JSON.stringify(_finRow(expected, headers));
}

function _finActive(op) { return op.state !== 'acknowledged' && op.state !== 'cancelled' && op.state !== 'reviewed'; }

function _finAddMonth(date) {
  var p = String(date).split('-').map(Number), m = p[1] + 1, y = p[0];
  if (m > 12) { m = 1; y++; }
  return _clampDayIso(y, m, p[2]);
}

function _finClient(id) {
  var sh = _ss().getSheetByName('Clients');
  if (!sh) throw new Error('client_not_found');
  var values = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, CLIENTS_HEADERS.length).getValues() : [];
  var hits = [];
  values.forEach(function (r, i) {
    if (String(r[0]) === String(id)) {
      var obj = {}; CLIENTS_HEADERS.forEach(function (h, c) { obj[h] = r[c] == null ? '' : r[c]; });
      hits.push({ sheet: sh, row: i + 2, client: obj });
    }
  });
  if (hits.length !== 1) throw new Error(hits.length ? 'duplicate_client' : 'client_not_found');
  return hits[0];
}

function _finDue(c) {
  if (c.nextBillingDate) return _asISODate(c.nextBillingDate);
  var anchor = c.packageChangeDate || c.paymentDate || c.startDate;
  if (anchor) return _finAddMonth(_asISODate(anchor));
  var t = _todayISODate(), bd = Number(c.billingDay) || Number(String(c.startDate || '').slice(8, 10));
  return bd ? _clampDayIso(Number(t.slice(0, 4)), Number(t.slice(5, 7)), bd) : t;
}

function _finGuard(clientIds) {
  var wanted = (clientIds || []).filter(function (v) { return v != null && v !== ''; }).map(String);
  var ops = _finJournal().ops;
  for (var i = 0; i < ops.length; i++) {
    if (_finActive(ops[i]) && wanted.indexOf(ops[i].clientId) >= 0) throw new Error('financial_operation_pending');
  }
}

function _finGuardRewrite(sh, headers, rows) {
  var name = sh.getName();
  if (['Clients', 'Payments', 'ClientCharges'].indexOf(name) < 0) return;
  var ops = _finJournal().ops.filter(_finActive);
  if (!ops.length) return;
  var old = _readAll(sh, headers);
  ops.forEach(function (op) {
    function belongs(r) { return name === 'Clients' ? String(r.id) === op.clientId :
      String(r.clientId) === op.clientId || (name === 'Payments' && _finPaymentOwner(r.id) === op.clientId); }
    var before = old.filter(belongs).map(function (r) { return JSON.stringify(_finRow(r, headers)); }).sort();
    var after = rows.filter(belongs).map(function (r) { return JSON.stringify(_finRow(r, headers)); }).sort();
    if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('financial_operation_pending');
  });
}

function _finIntent(payload) {
  var p = payload.payment || {}, patch = payload.patch || {}, out = {};
  var fields = ['pricePerSession', 'paymentDate', 'nextBillingDate', 'sessionsPerWeek', 'packageChangeDate'];
  fields.forEach(function (k) { if (_hasOwn(patch, k)) out[k] = String(patch[k] == null ? '' : patch[k]); });
  if (Object.keys(patch).some(function (k) { return fields.indexOf(k) < 0; })) throw new Error('invalid_renewal_patch');
  var payment = {}; PAYMENTS_HEADERS.forEach(function (h) { payment[h] = String(p[h] == null ? '' : p[h]); });
  var intent = { opId: String(payload.opId || ''), clientId: String(payload.clientId || ''),
    snapshot: String(payload.snapshot || ''), cycleDate: String(payload.cycleDate || ''), patch: out, payment: payment };
  if (!/^[A-Za-z0-9_-]{12,120}$/.test(intent.opId) || !intent.clientId ||
      !intent.snapshot || JSON.stringify(intent).length > 40000) throw new Error('invalid_renewal_intent');
  return intent;
}

function _finIntentError(intent, c, stored) {
  var p = intent.payment, patch = intent.patch;
  if (!intent.cycleDate || _coverageDateISO(intent.cycleDate) !== intent.cycleDate ||
      (!stored && intent.cycleDate !== _finDue(c)) || patch.nextBillingDate !== _finNext(c, intent.cycleDate)) return 'renewal_period_changed';
  if (!patch.paymentDate || _coverageDateISO(patch.paymentDate) !== patch.paymentDate ||
      p.paymentDate !== patch.paymentDate || !isFinite(Number(patch.pricePerSession)) ||
      Number(patch.pricePerSession) <= 0 || String(Number(patch.pricePerSession)) !== patch.pricePerSession ||
      p.id !== 'pay::' + intent.clientId + '::base::' + intent.cycleDate.slice(0, 7) ||
      p.clientId !== intent.clientId || p.dueDate !== intent.cycleDate || p.status !== 'paid' ||
      p.billingType !== 'monthly' || p.amountDue !== patch.pricePerSession || p.amountPaid !== patch.pricePerSession ||
      (p.bundleSize !== '' && p.bundleSize !== '0') || (p.sessionsUsed !== '' && p.sessionsUsed !== '0') ||
      _coveragePeriodError(p.coverageStart, p.coverageEnd)) return 'invalid_renewal_payment';
  if (_hasOwn(patch, 'sessionsPerWeek') !== _hasOwn(patch, 'packageChangeDate')) return 'invalid_renewal_package';
  if (_hasOwn(patch, 'sessionsPerWeek')) {
    var sessions, services = String(c.serviceType || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    try { sessions = JSON.parse(patch.sessionsPerWeek); } catch (_) { return 'invalid_renewal_package'; }
    if (!sessions || Array.isArray(sessions) || typeof sessions !== 'object' || patch.packageChangeDate !== patch.paymentDate ||
        Object.keys(sessions).some(function (k) {
          if (k === '_units') return !sessions[k] || typeof sessions[k] !== 'object' || Array.isArray(sessions[k]) ||
            Object.keys(sessions[k]).some(function (s) { return services.indexOf(s) < 0 || ['שבוע', 'חודש'].indexOf(sessions[k][s]) < 0; });
          return services.indexOf(k) < 0 || typeof sessions[k] !== 'number' || !isFinite(sessions[k]) || sessions[k] < 0 || Math.floor(sessions[k]) !== sessions[k];
        })) return 'invalid_renewal_package';
  }
  return '';
}

function _finJournal() {
  var sh = _ss().getSheetByName('FinancialOps');
  if (!sh) {
    if (PropertiesService.getScriptProperties().getProperty('FINANCIAL_OPS_CREATED')) {
      throw new Error('financial_journal_missing');
    }
    return { sheet: null, ops: [] };
  }
  var grid = sh.getDataRange().getValues();
  if (JSON.stringify(grid[0]) !== JSON.stringify(FINANCIAL_OP_HEADERS)) throw new Error('financial_journal_headers');
  var seen = {}, active = {}, ops = [];
  for (var i = 1; i < grid.length; i++) {
    var cells = grid[i];
    if (cells.every(function (v) { return v === '' || v == null; })) continue;
    var op = {};
    FINANCIAL_OP_HEADERS.forEach(function (h, c) { op[h] = String(cells[c] == null ? '' : cells[c]); });
    var intent, before, after;
    try { intent = JSON.parse(op.intent); before = JSON.parse(op.before); after = JSON.parse(op.after); }
    catch (_) { throw new Error('financial_journal_corrupt'); }
    if (!op.id || !op.clientId || seen[op.id] || FINANCIAL_OP_STATES.indexOf(op.state) < 0 ||
        !before || !after || !Array.isArray(before.headers) || !Array.isArray(before.values) ||
        !Array.isArray(after.values) || !before.headers.length || before.headers.length > CLIENTS_HEADERS.length ||
        JSON.stringify(before.headers) !== JSON.stringify(CLIENTS_HEADERS.slice(0, before.headers.length)) ||
        JSON.stringify(after.headers) !== JSON.stringify(before.headers) || before.values.length !== before.headers.length ||
        after.values.length !== before.values.length || before.values[0] !== op.clientId || after.values[0] !== op.clientId ||
        !intent || intent.clientId !== op.clientId || intent.opId !== op.id ||
        intent.cycleDate !== op.cycleDate ||
        (intent.kind === 'extra_charge' ? (intent.payment ? intent.payment.id : '') !== op.paymentId :
          !intent.payment || intent.payment.id !== op.paymentId)) {
      throw new Error('financial_journal_corrupt');
    }
    // A partially edited journal must not become a new authority for a payment.
    // Bind the immutable preimage/patch/postimage, even for legacy empty stamps.
    var original = {};
    before.headers.forEach(function (h, c) { original[h] = before.values[c]; });
    if (intent.kind === 'extra_charge') {
      if (intent.snapshot !== op.before || op.after !== op.before ||
          JSON.stringify(_extraIntent(intent, true)) !== op.intent ||
          before.values.some(function (v) { return typeof v !== 'string'; }) ||
          ['client_writing', 'client_done'].indexOf(op.state) >= 0 ||
          (!intent.payment && op.state === 'payment_writing') ||
          (_finActive(op) && _extraIntentV1Error(intent, original))) throw new Error('financial_journal_corrupt');
    } else {
    if (intent.kind || ['charge_writing', 'charge_done'].indexOf(op.state) >= 0) throw new Error('financial_journal_corrupt');
    if (intent.snapshot !== op.before || JSON.stringify(_finIntent(intent)) !== op.intent ||
        (_finActive(op) && _finIntentError(intent, original, true)) || before.values.some(function (v) { return typeof v !== 'string'; }) ||
        after.values.some(function (v, c) {
          var h = before.headers[c];
          if (typeof v !== 'string') return true;
          if (h === 'updatedAt') return !/^\d{4}-\d{2}-\d{2}T/.test(v) || isNaN(Date.parse(v));
          if (h === 'updatedBy') return false;
          return v !== (_hasOwn(intent.patch, h) ? intent.patch[h] : before.values[c]);
        })) throw new Error('financial_journal_corrupt');
    }
    if (_finActive(op) && active[op.clientId]) throw new Error('financial_journal_duplicate_active');
    seen[op.id] = true;
    if (_finActive(op)) active[op.clientId] = true;
    op.row = i + 1;
    ops.push(op);
  }
  return { sheet: sh, ops: ops };
}

function _finNext(c, due) {
  var p = due.split('-').map(Number), m = p[1] + 1, y = p[0];
  if (m > 12) { m = 1; y++; }
  return _nextCycleDueDate(c, y + '-' + ('0' + m).slice(-2) + '-01') || _finAddMonth(due);
}

function _finPaymentOwner(id) {
  var m = /^pay::(.+?)::/.exec(String(id || ''));
  return m ? m[1] : '';
}

function _finPayments(paymentId, clientId, cycle) {
  var sh = _ss().getSheetByName('Payments');
  if (!sh) return [];
  return _readAll(sh, PAYMENTS_HEADERS).filter(function (p) {
    return String(p.id) === paymentId || String(p.id) === 'pay::' + clientId + '::' + cycle.slice(0, 7);
  });
}

function _finRow(row, headers) {
  return headers.map(function (h) {
    var v = row && row[h];
    if (v instanceof Date) return _asISODate(v);
    return v == null ? '' : String(v);
  });
}

function _finSnapshot(row, headers) {
  headers = headers || CLIENTS_HEADERS;
  return JSON.stringify({ headers: headers, values: _finRow(row, headers) });
}

function _finSummary(op) {
  var intent = JSON.parse(op.intent);
  return { id: op.id, clientId: op.clientId, cycleDate: op.cycleDate,
    kind: intent.kind || 'renewal', charge: intent.charge || null,
    state: op.state, payment: intent.payment, resolution: op.resolution,
    updatedAt: op.updatedAt, updatedBy: op.updatedBy };
}

function _finWrite(journal, op, state, user, resolution) {
  op.state = state; op.updatedAt = new Date().toISOString(); op.updatedBy = String(user || '');
  if (resolution !== undefined) op.resolution = resolution;
  journal.sheet.getRange(op.row, 1, 1, FINANCIAL_OP_HEADERS.length).setNumberFormat('@')
    .setValues([_finRow(op, FINANCIAL_OP_HEADERS)]);
}

function _formatPhoneColumns(sh, headers) {
  var maxRows = sh.getMaxRows();
  if (maxRows < 2) return;
  for (var i = 0; i < headers.length; i++) {
    if (_isTextForcedColumn(headers[i])) {
      sh.getRange(2, i + 1, maxRows - 1, 1).setNumberFormat('@');
    }
  }
}

function _hasOwn(obj, k) { return Object.prototype.hasOwnProperty.call(obj, k); }

function _integrityCaptureData(sourceSs) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Backup capture lock unavailable');
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty('OUTPATIENT_RECOVERY_HOLD')) throw new Error('recovery_pending');
    var specs = _integritySourceSpecs(), known = Object.create(null);
    var journalRequired = !!props.getProperty('FINANCIAL_OPS_CREATED');
    var previouslyPresent = JSON.parse(props.getProperty('INTEGRITY_REQUIRED_SOURCES') || '[]');
    if (!Array.isArray(previouslyPresent)) throw new Error('Invalid backup source history');
    previouslyPresent.forEach(function (name) {
      if (typeof name !== 'string' || !sourceSs.getSheetByName(name)) throw new Error('Previously captured source missing: ' + name);
    });
    var captured = specs.map(function (spec) {
      known[spec.source] = true;
      var sh = sourceSs.getSheetByName(spec.source);
      if (!sh && (spec.required || (spec.source === 'FinancialOps' && journalRequired))) {
        throw new Error('Missing backup source: ' + spec.source);
      }
      var range = sh ? sh.getDataRange() : null;
      var grid = range ? range.getValues() : [spec.headers.slice()];
      // Capture damaged/legacy data faithfully; strict operational schema and
      // duplicate-key checks belong to the recovery gate, not data destruction.
      if (!grid.length || !grid[0].length || (spec.key && grid[0].indexOf(spec.key) === -1)) {
        throw new Error('Invalid backup headers: ' + spec.source);
      }
      return { source: spec.source, prefix: spec.prefix, absent: !sh,
        grid: grid, formats: range ? range.getNumberFormats() : null };
    });
    var unknown = [];
    sourceSs.getSheets().forEach(function (sh) {
      var name = sh.getName();
      if (_hasOwn(known, name)) return;
      if (name === '__RecoveryMetadata') throw new Error('Reserved backup source name');
      unknown.push(name);
      var range = sh.getDataRange();
      captured.push({ source: name, prefix: _integrityOtherPrefix(name), absent: false,
        grid: range.getValues(), formats: range.getNumberFormats() });
    });
    // No credentials, auth secrets or PINs are copied from Script Properties.
    // Inventory is hashed along with the datasets and published last in manifest.
    var meta = [['key', 'value'], ['schemaVersion', '2'],
      ['sourceSpreadsheetId', sourceSs.getId()], ['capturedAt', new Date().toISOString()],
      ['financialOpsCreated', journalRequired ? '1' : '0'],
      ['inventory', JSON.stringify(captured.map(function (x) { return [x.source, x.prefix, x.absent ? '1' : '0']; }))],
      ['knownSources', JSON.stringify(specs.map(function (x) { return x.source; }))],
      ['unclassifiedSources', JSON.stringify(unknown)]];
    captured.push({ source: '__RecoveryMetadata', prefix: 'recovery-meta-', absent: false, grid: meta, formats: null });
    return captured;
  } finally { lock.releaseLock(); }
}

function _integrityFingerprint(grid) {
  var typed = grid.map(function (r) { return r.map(function (v) {
    return v instanceof Date ? ['date', v.toISOString()] : [typeof v, v];
  }); });
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(typed), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function _integrityManualPolicyRows(policy) {
  function fields(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys.slice().sort())) {
      throw new Error('Invalid manual recovery policy fields');
    }
    return keys.map(function (key) { return value[key]; });
  }
  var keys = ['version', 'sourceId', 'backupId', 'day', 'targetId', 'manifestSha256', 'metadataSha256', 'evidence', 'tabs'];
  fields(policy, keys);
  var evidenceKeys = ['recordPath', 'sha256', 'operator', 'captureStartedAt', 'captureEndedAt',
    'beforeInventorySha256', 'afterInventorySha256', 'nativeCopyId', 'directWritesPaused',
    'formulasAbsent', 'nativePropertiesVerified', 'targetCreatedAt', 'targetInitiallyEmpty', 'targetOwnerOnly'];
  var tabKeys = ['source', 'sheetId', 'prefix', 'absent', 'role', 'sha256', 'rows', 'columns', 'allocatedRows', 'allocatedColumns'];
  if (!Array.isArray(policy.tabs)) throw new Error('Invalid manual recovery policy tabs');
  var tabs = policy.tabs.map(function (tab) { return fields(tab, tabKeys); });
  tabs.sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  return [['outpatient-manual-recovery-policy-v1'], keys.slice(0, 7).map(function (key) { return policy[key]; }),
    fields(policy.evidence, evidenceKeys)].concat(tabs);
}

function _integrityOtherPrefix(source) {
  return 'other-' + _integrityFingerprint([[source]]) + '-';
}

function _integrityRecoveryMetadata(captured) {
  var item = captured.filter(function (x) { return x.source === '__RecoveryMetadata'; })[0];
  if (!item || item.absent) throw new Error('Legacy backup is not a full operational recovery set');
  var grid = item.grid, meta = {};
  var fields = ['schemaVersion', 'sourceSpreadsheetId', 'capturedAt', 'financialOpsCreated', 'inventory', 'knownSources', 'unclassifiedSources'];
  if (JSON.stringify(grid[0]) !== JSON.stringify(['key', 'value']) || grid.length !== fields.length + 1) throw new Error('Invalid recovery metadata');
  grid.slice(1).forEach(function (r) {
    if (r.length !== 2 || fields.indexOf(r[0]) < 0 || _hasOwn(meta, r[0]) || typeof r[1] !== 'string') throw new Error('Invalid recovery metadata');
    meta[r[0]] = r[1];
  });
  if (meta.schemaVersion !== '2' || !meta.sourceSpreadsheetId || !isFinite(Date.parse(meta.capturedAt)) ||
      ['0', '1'].indexOf(meta.financialOpsCreated) < 0 ||
      !Array.isArray(JSON.parse(meta.inventory)) || !Array.isArray(JSON.parse(meta.knownSources)) ||
      !Array.isArray(JSON.parse(meta.unclassifiedSources))) throw new Error('Invalid recovery metadata');
  return meta;
}

function _integritySourceSpecs() {
  var specs = [
    { source: 'Clients', prefix: '', key: 'id', headers: CLIENTS_HEADERS, required: true },
    { source: 'Leads', prefix: 'leads-', key: 'id', headers: LEADS_HEADERS, required: true },
    { source: 'לידים שהוסרו', prefix: 'leads-removed-', key: 'id', headers: REMOVED_LEADS_HEADERS },
    { source: 'Clients-removed', prefix: 'clients-removed-', key: 'id', headers: CLIENTS_REMOVED_HEADERS },
    { source: 'Payments', prefix: 'payments-', key: 'id', headers: PAYMENTS_HEADERS },
    { source: 'ClientCharges', prefix: 'charges-', key: 'id', headers: CHARGES_HEADERS },
    { source: 'Credits', prefix: 'credits-', key: 'id', headers: CREDIT_COLUMNS },
    { source: 'FinancialOps', prefix: 'financial-ops-', key: 'id', headers: FINANCIAL_OP_HEADERS },
    { source: 'SessionLog', prefix: 'session-log-', key: 'sessionId', headers: SESSION_LOG_HEADERS },
    { source: 'TherapistRates', prefix: 'therapist-rates-', key: 'name', headers: THERAPIST_RATES_HEADERS },
    { source: 'Settings', prefix: 'settings-', key: 'key', headers: SETTINGS_HEADERS },
    { source: 'StopFlags', prefix: 'stop-flags-', key: 'id', headers: STOP_FLAGS_HEADERS },
    { source: 'ExtraSessionRequests', prefix: 'extra-sessions-', key: 'id', headers: EXTRA_SESSION_HEADERS },
    { source: CONTINUATION_SHEET, prefix: 'continuation-', key: 'key', headers: CONTINUATION_HEADERS },
    { source: STOP_ALERTS_SHEET, prefix: 'stop-alerts-', key: 'id', headers: STOP_ALERTS_HEADERS },
    { source: AUDIT_LOG_SHEET, prefix: 'audit-log-', headers: AUDIT_LOG_HEADERS },
    { source: REPAIR_PLAN_SHEET, prefix: 'repair-plan-', headers: REPAIR_PLAN_HEADERS }
  ];
  if (typeof PACKAGE_CATALOG_HEADERS !== 'undefined' && typeof PACKAGE_REQUEST_HEADERS !== 'undefined') {
    specs.push({ source: 'PackageCatalog', prefix: 'package-catalog-', key: 'id', headers: PACKAGE_CATALOG_HEADERS });
    specs.push({ source: 'PackageRequests', prefix: 'package-requests-', key: 'id', headers: PACKAGE_REQUEST_HEADERS });
  }
  return specs;
}

function _integrityValidateRestoreSet(backupSs, day, requireJournal) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) throw new Error('Invalid restore date');
  var sh = backupSs.getSheetByName(INTEGRITY_SNAPSHOT_PREFIX + 'manifest-' + day);
  if (!sh) throw new Error('Restore manifest missing');
  var rows = sh.getDataRange().getValues();
  if (JSON.stringify(rows[0]) !== JSON.stringify(['id', 'source', 'snapshot', 'absent', 'sha256'])) {
    throw new Error('Invalid restore manifest');
  }
  var prefixes = Object.create(null), seen = Object.create(null), isCurrent = rows.some(function (r) { return r[1] === '__RecoveryMetadata'; });
  _integritySourceSpecs().forEach(function (x) { prefixes[x.source] = x.prefix; });
  // Inspect legacy package sets even before their business module is deployed.
  prefixes.PackageCatalog = 'package-catalog-'; prefixes.PackageRequests = 'package-requests-';
  prefixes.__RecoveryMetadata = 'recovery-meta-';
  var result = rows.slice(1).map(function (row) {
    var source = String(row[1]), prefix = _hasOwn(prefixes, source) ? prefixes[source] : _integrityOtherPrefix(source);
    if (isCurrent && !_integritySourceSpecs().some(function (x) { return x.source === source; }) && row[2] === INTEGRITY_SNAPSHOT_PREFIX + _integrityOtherPrefix(source) + day) prefix = _integrityOtherPrefix(source);
    if (!source || seen[source] || row[0] !== source || row.length !== 5 ||
        row[2] !== INTEGRITY_SNAPSHOT_PREFIX + prefix + day || ['0', '1'].indexOf(String(row[3])) < 0 ||
        !/^[a-f0-9]{64}$/.test(String(row[4]))) throw new Error('Invalid restore manifest entry');
    seen[source] = true;
    var data = backupSs.getSheetByName(String(row[2]));
    if (!data) throw new Error('Restore snapshot missing: ' + source);
    var grid = data.getDataRange().getValues();
    if (_integrityFingerprint(grid) !== row[4]) throw new Error('Restore snapshot mismatch: ' + source);
    if (String(row[3]) === '1' && grid.length !== 1) throw new Error('Absent restore snapshot contains rows');
    if (source === 'FinancialOps' && requireJournal && (String(row[3]) === '1' ||
        JSON.stringify(grid[0].slice(0, FINANCIAL_OP_HEADERS.length)) !== JSON.stringify(FINANCIAL_OP_HEADERS))) {
      throw new Error('Restore journal required');
    }
    return { source: source, prefix: prefix, absent: String(row[3]) === '1', grid: grid };
  });
  var legacy = ['Clients', 'Leads', 'לידים שהוסרו', 'Clients-removed', 'Payments', 'ClientCharges', 'Credits', 'FinancialOps'];
  if (!isCurrent) {
    var allowed = legacy.concat(result.length === 10 ? ['PackageCatalog', 'PackageRequests'] : []);
    if (result.length !== allowed.length || allowed.some(function (n) { return !seen[n]; })) throw new Error('Invalid restore manifest');
    return result; // inspection only; never passes the operational recovery gate
  }
  var meta = _integrityRecoveryMetadata(result), inventory = JSON.parse(meta.inventory);
  var known = JSON.parse(meta.knownSources), unknown = JSON.parse(meta.unclassifiedSources);
  var required = _integritySourceSpecs().map(function (x) { return x.source; });
  // A package-aware artifact must retain both datasets, even in an older runtime.
  if (known.indexOf('PackageCatalog') >= 0 || known.indexOf('PackageRequests') >= 0) {
    ['PackageCatalog', 'PackageRequests'].forEach(function (n) { if (required.indexOf(n) < 0) required.push(n); });
  }
  if (JSON.stringify(known.slice().sort()) !== JSON.stringify(required.slice().sort()) ||
      inventory.length !== result.length - 1 || inventory.length !== known.length + unknown.length) throw new Error('Incomplete recovery inventory');
  var indexed = Object.create(null);
  inventory.forEach(function (row) {
    var item = result.filter(function (x) { return x.source === row[0]; })[0];
    if (!item || item.source === '__RecoveryMetadata' || indexed[item.source] || row.length !== 3 ||
        item.prefix !== row[1] || (item.absent ? '1' : '0') !== row[2]) throw new Error('Recovery inventory mismatch');
    indexed[item.source] = true;
  });
  if (known.some(function (n) { return !indexed[n]; }) || unknown.some(function (n, i) {
    return known.indexOf(n) >= 0 || unknown.indexOf(n) !== i || !indexed[n];
  })) throw new Error('Incomplete recovery inventory');
  if (meta.financialOpsCreated === '1' && result.some(function (x) { return x.source === 'FinancialOps' && x.absent; })) {
    throw new Error('Restore journal required');
  }
  return result;
}

function _integrityVerifyGrid(expected, actual) {
  if (expected.length !== actual.length) throw new Error('Backup row count mismatch');
  for (var r = 0; r < expected.length; r++) {
    if (expected[r].length !== actual[r].length) throw new Error('Backup column count mismatch');
    for (var c = 0; c < expected[r].length; c++) {
      var a = expected[r][c], b = actual[r][c];
      var equal = a instanceof Date ? b instanceof Date && a.getTime() === b.getTime() : a === b;
      if (!equal) throw new Error('Backup value mismatch at row ' + (r + 1) + ', column ' + (c + 1));
    }
  }
}

function _integrityVerifyManualPolicy(backupSs, day, targetSs, captured, meta, policy) {
  var pin = INTEGRITY_APPROVED_MANUAL_POLICY_SHA256;
  if (typeof pin !== 'string' || !/^[a-f0-9]{64}$/.test(pin)) {
    throw new Error('Unclassified sheets require a separately reviewed recovery plan');
  }
  if (_integrityFingerprint(_integrityManualPolicyRows(policy)) !== pin) throw new Error('Manual recovery policy digest mismatch');
  function hash(value) { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
  function text(value) { return typeof value === 'string' && value.trim().length > 0; }
  function instant(value) { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && isFinite(Date.parse(value)); }
  var metadata = captured.filter(function (item) { return item.source === '__RecoveryMetadata'; })[0];
  var manifest = backupSs.getSheetByName(INTEGRITY_SNAPSHOT_PREFIX + 'manifest-' + day).getDataRange().getValues();
  if (policy.version !== 1 || policy.sourceId !== meta.sourceSpreadsheetId || policy.backupId !== backupSs.getId() ||
      policy.day !== day || policy.targetId !== targetSs.getId() ||
      policy.manifestSha256 !== _integrityFingerprint(manifest) || policy.metadataSha256 !== _integrityFingerprint(metadata.grid)) {
    throw new Error('Manual recovery policy scope mismatch');
  }
  // These are reviewed operator attestations, NOT facts proved by v2 snapshots.
  // Their evidence digest is pinned; no Drive access or new scopes are implied.
  var e = policy.evidence;
  if (typeof e.recordPath !== 'string' || !/^docs\/evidence\/op03-manual-tabs-\d{4}-\d{2}-\d{2}(?:-[a-z0-9-]+)?\.md$/.test(e.recordPath) ||
      !hash(e.sha256) || !text(e.operator) || !instant(e.captureStartedAt) || !instant(e.captureEndedAt) ||
      Date.parse(e.captureStartedAt) > Date.parse(meta.capturedAt) || Date.parse(e.captureEndedAt) < Date.parse(meta.capturedAt) ||
      !hash(e.beforeInventorySha256) || e.beforeInventorySha256 !== e.afterInventorySha256 ||
      !text(e.nativeCopyId) || [policy.sourceId, policy.backupId, policy.targetId].indexOf(e.nativeCopyId) >= 0 ||
      e.directWritesPaused !== true || e.formulasAbsent !== true || e.nativePropertiesVerified !== true ||
      !instant(e.targetCreatedAt) || e.targetInitiallyEmpty !== true || e.targetOwnerOnly !== true) {
    throw new Error('Manual recovery evidence incomplete');
  }
  var unknown = JSON.parse(meta.unclassifiedSources), seen = Object.create(null), ids = Object.create(null);
  if (policy.tabs.length !== unknown.length) throw new Error('Manual recovery tab set mismatch');
  policy.tabs.forEach(function (tab) {
    var item = captured.filter(function (x) { return x.source === tab.source; })[0];
    if (unknown.indexOf(tab.source) < 0 || _hasOwn(seen, tab.source) || !item || item.absent || tab.absent !== false ||
        tab.prefix !== item.prefix || tab.sha256 !== _integrityFingerprint(item.grid) ||
        !Number.isInteger(tab.sheetId) || tab.sheetId < 0 || _hasOwn(ids, tab.sheetId) ||
        ['structural-empty', 'retained-archive'].indexOf(tab.role) < 0 ||
        tab.rows !== item.grid.length || tab.columns !== item.grid[0].length ||
        !Number.isInteger(tab.allocatedRows) || tab.allocatedRows < tab.rows ||
        !Number.isInteger(tab.allocatedColumns) || tab.allocatedColumns < tab.columns) {
      throw new Error('Manual recovery tab mismatch');
    }
    if (tab.role === 'structural-empty' && item.grid.some(function (row) { return row.some(function (v) { return v !== ''; }); })) {
      throw new Error('Manual recovery structural tab is not empty');
    }
    seen[tab.source] = true; ids[tab.sheetId] = true;
  });
  return policy.tabs;
}

function _integrityVerifyManualTarget(item, target, tab) {
  if (!target || target.getMaxRows() !== tab.allocatedRows || target.getMaxColumns() !== tab.allocatedColumns) {
    throw new Error('Manual recovery target bounds mismatch');
  }
  _integrityVerifyGrid(item.grid, target.getDataRange().getValues());
  if (target.getDataRange().getFormulas().some(function (row) { return row.some(function (v) { return v !== ''; }); })) {
    throw new Error('Manual recovery target contains formulas');
  }
}

function _integrityVerifyRecoveredWorkbook(backupSs, day, targetSs, configVerified, manualPolicy) {
  if (configVerified !== true) throw new Error('Recovery configuration verification required');
  var captured = _integrityValidateRestoreSet(backupSs, day, false), meta = _integrityRecoveryMetadata(captured);
  if (targetSs.getId() === backupSs.getId() || targetSs.getId() === meta.sourceSpreadsheetId) throw new Error('Recovery requires an isolated target');
  var unknown = JSON.parse(meta.unclassifiedSources);
  var manualTabs = unknown.length ? _integrityVerifyManualPolicy(backupSs, day, targetSs, captured, meta, manualPolicy) : [];
  var specs = _integritySourceSpecs(), names = Object.create(null);
  captured.forEach(function (item) {
    if (item.source === '__RecoveryMetadata') return;
    names[item.source] = true;
    var target = targetSs.getSheetByName(item.source);
    if (item.absent) { if (target) throw new Error('Absent source recreated: ' + item.source); return; }
    if (!target) throw new Error('Recovered sheet missing: ' + item.source);
    if (unknown.indexOf(item.source) >= 0) {
      _integrityVerifyManualTarget(item, target, manualTabs.filter(function (tab) { return tab.source === item.source; })[0]);
      return; // Unknown tabs never enter a known business schema or billing path.
    }
    _integrityVerifyGrid(item.grid, target.getDataRange().getValues());
    var spec = specs.filter(function (x) { return x.source === item.source; })[0];
    if (!spec || JSON.stringify(item.grid[0].slice(0, spec.headers.length)) !== JSON.stringify(spec.headers)) throw new Error('Recovery schema mismatch: ' + item.source);
    if (spec.key) {
      var keys = Object.create(null), col = item.grid[0].indexOf(spec.key);
      item.grid.slice(1).forEach(function (row) {
        if (!row.some(function (v) { return v !== ''; })) return;
        var key = String(row[col]);
        if (!key || _hasOwn(keys, key)) throw new Error('Recovery key invalid: ' + item.source);
        keys[key] = true;
      });
    }
  });
  ['Clients', 'Leads', 'SessionLog', 'TherapistRates', 'Settings'].forEach(function (name) {
    if (!targetSs.getSheetByName(name)) throw new Error('Operational recovery state missing: ' + name);
    if (name === 'TherapistRates' && targetSs.getSheetByName(name).getLastRow() < 2) throw new Error('Operational recovery rates empty');
  });
  if (targetSs.getSheets().some(function (sh) { return !names[sh.getName()]; })) throw new Error('Unexpected recovered sheet');
  var journal = captured.filter(function (x) { return x.source === 'FinancialOps'; })[0];
  return { ok: true, journalRequired: !journal.absent || meta.financialOpsCreated === '1' };
}

function _integrityWriteSnapshot(backupSs, snapName, grid, formats) {
  if (!INTEGRITY_DATA_SNAPSHOT_RE.test(snapName)) throw new Error('Invalid backup name');
  if (!grid || !grid.length || !grid[0].length) throw new Error('Empty backup grid');
  var lock = LockService.getUserLock();
  if (!lock.tryLock(1)) throw new Error('Backup writer already running');
  var sh = null, old = null, renamedOld = false, published = false;
  try {
    var token = Utilities.getUuid();
    sh = backupSs.insertSheet('outpatient-pending-' + token);
    if (sh.getMaxRows() < grid.length) sh.insertRowsAfter(sh.getMaxRows(), grid.length - sh.getMaxRows());
    if (sh.getMaxColumns() < grid[0].length) sh.insertColumnsAfter(sh.getMaxColumns(), grid[0].length - sh.getMaxColumns());
    var target = sh.getRange(1, 1, grid.length, grid[0].length);
    var safeFormats = grid.map(function (row, r) {
      return row.map(function (value, c) {
        return typeof value === 'string' ? '@' :
          (formats && formats[r] && formats[r][c]) || (value instanceof Date ? 'yyyy-mm-dd hh:mm:ss.000' : 'General');
      });
    });
    target.setNumberFormats(safeFormats);
    target.setValues(grid.map(function (row) {
      return row.map(function (value) { return typeof value === 'string' && value ? "'" + value : value; });
    }));
    SpreadsheetApp.flush();
    _integrityVerifyGrid(grid, target.getValues());
    var formulas = target.getFormulas();
    for (var r = 0; r < formulas.length; r++) {
      if (formulas[r].some(function (formula) { return !!formula; })) throw new Error('Backup contains a formula');
    }
    if (sh.getMaxRows() > grid.length) sh.deleteRows(grid.length + 1, sh.getMaxRows() - grid.length);
    if (sh.getMaxColumns() > grid[0].length) sh.deleteColumns(grid[0].length + 1, sh.getMaxColumns() - grid[0].length);
    old = backupSs.getSheetByName(snapName);
    if (old) { old.setName('outpatient-previous-' + token); renamedOld = true; }
    sh.setName(snapName);
    published = true;
    if (old) backupSs.deleteSheet(old);
    return sh;
  } catch (err) {
    if (renamedOld && !published) {
      try { old.setName(snapName); } catch (_) { /* Keep both recovery remnants. */ }
    }
    // A partial temporary sheet is never a published backup. Leave it visible
    // for diagnosis; do not risk deleting a good copy after an ambiguous RPC.
    throw err;
  } finally { lock.releaseLock(); }
}

function _isDayCenterBilling(billingType) {
  return String(billingType == null ? '' : billingType).trim() === DAY_CENTER_BILLING;
}

function _isRealCalendarDate(y, m1, day) {
  if (!(m1 >= 1 && m1 <= 12) || !(day >= 1 && day <= 31)) return false;
  var d = new Date(y, m1 - 1, day);
  return d.getFullYear() === y && d.getMonth() === m1 - 1 && d.getDate() === day;
}

function _isTextForcedColumn(name) {
  return !!(PHONE_COLUMNS[name] || STAMP_COLUMNS[name] || PACKAGE_TEXT_COLUMNS[name]);
}

function _loadTherapistRates() {
  var cached = null;
  try { cached = CacheService.getScriptCache().get('therapistRates_v1'); } catch (_) {}
  if (cached) { try { return JSON.parse(cached); } catch (_) {} }
  var sh = _ensureSheet(THERAPIST_RATES_SHEET, THERAPIST_RATES_HEADERS);
  var rows = _readAll(sh, THERAPIST_RATES_HEADERS);
  if (!rows.length) {   // first run: seed from the constants so nothing is lost
    var seed = [];
    Object.keys(THERAPIST_FLAT_RATES).forEach(function (n) {
      seed.push({ name: n, flatRate: THERAPIST_FLAT_RATES[n], intakeRate: '', followupRate: '' });
    });
    Object.keys(PSYCHIATRIST_RATES).forEach(function (n) {
      seed.push({ name: n, flatRate: '',
                  intakeRate: PSYCHIATRIST_RATES[n]['אינטייק'],
                  followupRate: PSYCHIATRIST_RATES[n]['מעקב פסיכיאטרי'] });
    });
    _writeAll(sh, THERAPIST_RATES_HEADERS, seed);
    rows = seed;
  }
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var n = String(rows[i].name == null ? '' : rows[i].name).trim();
    if (!n) continue;
    map[n] = {
      flat: parseFloat(rows[i].flatRate),
      intake: parseFloat(rows[i].intakeRate),
      followup: parseFloat(rows[i].followupRate)
    };
  }
  try { CacheService.getScriptCache().put('therapistRates_v1', JSON.stringify(map), 120); } catch (_) {}
  return map;
}

function _markForwarded(payload) {
  var therapist = String((payload && payload.therapist) || '').trim();
  if (!therapist) return { ok: false, reason: 'missing_therapist' };
  var month = _payoutMonthOf((payload && payload.month) || '');
  if (!month) return { ok: false, reason: 'invalid_month' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (PropertiesService.getScriptProperties().getProperty('OUTPATIENT_RECOVERY_HOLD')) throw new Error('recovery_pending');
    var sh = _ensureSheet('SessionLog', SESSION_LOG_HEADERS);
    var rows = _readAll(sh, SESSION_LOG_HEADERS);
    var forwarded = 0;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (String(row.therapist || '').trim() !== therapist) continue;
      if (_payoutMonthOf(row.date) !== month) continue;
      if (String(row.forwardedToPayroll || '').trim() !== '') continue; // already settled
      row.forwardedToPayroll = month;
      forwarded++;
    }
    if (forwarded) _writeAll(sh, SESSION_LOG_HEADERS, rows);
    return { ok: true, therapist: therapist, month: month, forwarded: forwarded };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _monthKey(dateStr) {
  var s = String(dateStr == null ? '' : dateStr).trim();
  return /^\d{4}-\d{2}/.test(s) ? s.slice(0, 7) : '';
}

function _nextCycleDueDate(cl, todayIso) {
  var bd = null;
  var raw = cl && cl.billingDay;
  if (raw !== '' && raw != null && isFinite(Number(raw)) && Number(raw) >= 1) {
    bd = Math.floor(Number(raw));
  }
  if (!bd) {
    var sd = String((cl && cl.startDate) || '').slice(0, 10).split('-');
    if (sd.length === 3) {
      var d = parseInt(sd[2], 10);
      if (isFinite(d) && d >= 1) bd = d;
    }
  }
  if (!bd) return '';
  var t = String(todayIso || '').slice(0, 10).split('-');
  var y = parseInt(t[0], 10);
  var m = parseInt(t[1], 10);
  if (!isFinite(y) || !isFinite(m)) return '';
  var candidate = _clampDayIso(y, m, bd);
  if (candidate < todayIso) {
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    candidate = _clampDayIso(y, m, bd);
  }
  return candidate;
}

function _payoutMonthOf(dateCell) {
  var s = String(dateCell == null ? '' : dateCell).trim();
  if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{2})/);
  if (m) return m[1] + '-' + m[2];
  var d = new Date(s);
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

function _planWeeklyFrequency(client) {
  if (!client) return 0;
  var s = String(client.sessionsPerWeek == null ? '' : client.sessionsPerWeek).trim();
  if (!s) return 0;
  var total = 0;
  if (s.charAt(0) === '{') {
    try {
      var o = JSON.parse(s);
      Object.keys(o).forEach(function (k) { var n = parseInt(o[k], 10); if (!isNaN(n) && n > 0) total += n; });
    } catch (_) { return 0; }
  } else {
    var n = parseInt(s, 10);
    if (!isNaN(n) && n > 0) total = n;
  }
  return total;
}

function _readAll(sh, headers) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var values = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    if (row.every(function (c) { return c === '' || c === null; })) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      var v = row[c];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd');
      } else if (PHONE_COLUMNS[headers[c]]) {
        v = _recoverPhone(v);   // restore leading zero dropped by Sheets coercion
      }
      obj[headers[c]] = v;
    }
    out.push(obj);
  }
  return out;
}

function _readDataVersion() {
  var raw = PropertiesService.getScriptProperties().getProperty(CLIENTS_DATA_VERSION_PROP);
  var n = parseInt(raw, 10);
  return (isNaN(n) || n < 0) ? 0 : n;
}

function _recordSessionOutcome(payload) {
  var sessionId = String((payload && payload.sessionId) || '').trim();
  if (!sessionId) return { ok: false, reason: 'missing_session_id' };

  var outcome = String((payload && payload.outcome) || '').trim();
  if (!_hasOwn(SESSION_STATUS_BY_OUTCOME, outcome)) {
    return { ok: false, reason: 'unknown_outcome' };
  }

  var clinical = String((payload && payload.clinicalTreatmentType) || '').trim();
  if (!clinical || !_hasOwn(CLINICAL_TO_BILLING, clinical)) {
    return { ok: false, reason: 'unknown_type' };
  }
  var billingType = _clinicalToBilling(clinical);
  var therapist = String((payload && payload.therapist) || '').trim();

  // Frequency only matters for ליווי; absent everywhere else. Accept either key.
  var freq;
  if (payload && payload.freqPerWeek != null && payload.freqPerWeek !== '') freq = payload.freqPerWeek;
  else if (payload && payload.frequencyPerWeek != null && payload.frequencyPerWeek !== '') freq = payload.frequencyPerWeek;

  var therapistPay, clientSessionValue;
  try {
    therapistPay = _computeSessionPay(outcome, therapist, clinical, billingType);
  } catch (err) {
    return { ok: false, reason: 'unknown_therapist' };
  }
  try {
    clientSessionValue = _computeSessionValue(billingType, freq);
  } catch (err) {
    return { ok: false, reason: 'invalid_frequency' };
  }

  var sessionStatus = SESSION_STATUS_BY_OUTCOME[outcome];
  var phone = _recoverPhone(payload && payload.phone);
  var patientName = String((payload && payload.patientName) || '').trim();

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (PropertiesService.getScriptProperties().getProperty('OUTPATIENT_RECOVERY_HOLD')) throw new Error('recovery_pending');
    // Optional client match for enrichment — never gates the log (keyed by session).
    // A SINGLE phone hit also unlocks the credit engine (we can read+write that
    // client's creditsOwed); 0 or >1 hits leave the patient balance untouched.
    var clientsSh = _ensureSheet('Clients', CLIENTS_HEADERS);
    var clients = _readAll(clientsSh, CLIENTS_HEADERS);
    var clientId = '', matchStatus = 'no_match', matchedClient = null;
    if (phone && /^0\d{8,9}$/.test(phone)) {
      var hits = [];
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if (_recoverPhone(c.phone) === phone ||
            _recoverPhone(c.treatmentContactPhone) === phone ||
            _recoverPhone(c.payerPhone) === phone) {
          hits.push(c);
        }
      }
      if (hits.length === 1) {
        matchedClient = hits[0];
        clientId = String(matchedClient.id);
        matchStatus = 'matched';
        if (!patientName) patientName = String(matchedClient.name == null ? '' : matchedClient.name).trim();
      } else if (hits.length > 1) {
        matchStatus = 'multi_match';
      }
    }

    var rowObj = {
      sessionId:          sessionId,
      phone:              phone,
      patientName:        patientName,
      clientId:           clientId,
      therapist:          therapist,
      clinicalTreatmentType: clinical,
      billingType:        billingType,
      date:               String((payload && payload.date) || '').trim(),
      outcome:            outcome,
      therapistPay:       therapistPay,
      clientSessionValue: clientSessionValue,   // null -> blank cell (flag)
      sessionStatus:      sessionStatus,
      matchStatus:        matchStatus,
      recordedAt:         new Date().toISOString(),
      creditStatus:       '',
      // Preserved below from the existing row on an upsert — a re-sent / corrected
      // outcome must NOT lose an already-forwarded stamp (only _markForwarded sets it).
      forwardedToPayroll: ''
    };

    var sh = _ensureSheet('SessionLog', SESSION_LOG_HEADERS);

    // ---- Credit engine -----------------------------------------------------
    // creditsOwed is a stateful running balance, so an UPSERT must first REVERSE
    // the effect the existing row for this sessionId had, then apply the new
    // outcome's effect (idempotent re-send nets zero; a real correction undoes
    // the old and applies the new — e.g. happened-covered -> cancelled gives the
    // drawn credit back AND adds the cancellation credit). We do NOT re-simulate
    // sibling rows: reversing one row's own effect is locally correct; the
    // month's other draws keep whatever they resolved to (documented).
    var logRows = _readAll(sh, SESSION_LOG_HEADERS);
    var oldRow = null;
    for (var lr = 0; lr < logRows.length; lr++) {
      if (String(logRows[lr].sessionId) === sessionId) { oldRow = logRows[lr]; break; }
    }
    // Preserve an already-forwarded stamp across the upsert: a correction re-runs
    // pay/credit but must not silently un-forward a session payroll already received.
    var wasForwarded = !!(oldRow && String(oldRow.forwardedToPayroll || '').trim() !== '');
    if (wasForwarded) {
      rowObj.forwardedToPayroll = String(oldRow.forwardedToPayroll).trim();
    }

    // ---- FORWARDED ROWS ARE PAY-FROZEN -------------------------------------
    // Once a session's month has gone to חשבת שכר, that money is out the door.
    // Before this guard only the forwardedToPayroll STAMP survived the upsert —
    // therapistPay was recomputed unconditionally, so a re-mark silently rewrote
    // the pay on a row payroll had already been sent, and the payout view (which
    // excludes forwarded rows) never showed the change to anyone.
    //
    // Carry the stored amount instead, for EVERY outcome: the frozen figure is
    // the record of what payroll actually received. A genuine correction belongs
    // in the next cycle as a הפרש, not as a silent rewrite of a settled row.
    //
    // Credit effects are deliberately NOT frozen — creditsOwed is a separate,
    // still-open ledger and the reversal below stays correct.
    if (wasForwarded) {
      rowObj.therapistPay = _toNumberOrZero(oldRow.therapistPay);
    }

    if (matchedClient) {
      var origCredits = _toCredits(matchedClient.creditsOwed);
      var balance = origCredits;
      // 1) reverse the old row's effect on this client's balance
      if (oldRow) {
        if (oldRow.outcome === 'therapist_cancelled') balance -= 1;       // undo the +1
        if (String(oldRow.creditStatus) === 'covered')  balance += 1;       // undo the draw (give it back)
      }
      if (balance < 0) balance = 0;
      // 2) apply the new outcome's effect
      if (outcome === 'therapist_cancelled') {
        balance += 1;
        rowObj.creditStatus = 'credit_added';
      } else if (outcome === 'happened') {
        var quotaFreq = _planWeeklyFrequency(matchedClient);
        if (!quotaFreq && freq != null && freq !== '') {           // fall back to the event frequency
          var ef = parseInt(freq, 10);
          if (!isNaN(ef) && ef > 0) quotaFreq = ef;
        }
        var month = _monthKey(rowObj.date);
        if (!quotaFreq || !month) {
          rowObj.creditStatus = 'quota_unknown';                   // can't bucket -> never draw
        } else {
          var quota = quotaFreq * 4;
          var priorHappened = 0;                                   // delivered this month, excluding self
          for (var hh = 0; hh < logRows.length; hh++) {
            var lrow = logRows[hh];
            if (String(lrow.sessionId) === sessionId) continue;
            if (String(lrow.clientId) === clientId &&
                lrow.outcome === 'happened' &&
                _monthKey(lrow.date) === month) priorHappened++;
          }
          var beyondQuota = priorHappened >= quota;
          if (!beyondQuota) {
            rowObj.creditStatus = 'within_quota';
          } else if (balance > 0 && typeof clientSessionValue === 'number' && clientSessionValue > 0) {
            clientSessionValue = 0;                                // credit covers this session
            rowObj.clientSessionValue = 0;
            balance -= 1;
            rowObj.creditStatus = 'covered';
          } else {
            rowObj.creditStatus = 'beyond_no_credit';              // beyond quota, no credit to draw
          }
        }
      }
      // 3) persist the balance only if it actually changed (single cell — the old
      //    whole-sheet _writeAll here was the save-path hotspot)
      if (balance !== origCredits) {
        matchedClient.creditsOwed = balance;
        // who/when: '' for the cross-app receiver; the internal
        // correctSessionOutcome path carries the proxy-injected user.
        _writeCreditsOwed(clientsSh, clientId, balance, _requestUser(payload));
      }
      rowObj.creditsOwed = balance;
    } else if (outcome === 'happened' || outcome === 'therapist_cancelled') {
      // No single client to credit/debit — flag, change no balance.
      rowObj.creditStatus = 'no_client';
    }
    // ------------------------------------------------------------------------

    var rowArr = SESSION_LOG_HEADERS.map(function (h) {
      var v = rowObj[h];
      return (v === undefined || v === null) ? '' : v;
    });
    var idIdx = SESSION_LOG_HEADERS.indexOf('sessionId');
    var lastRow = sh.getLastRow();
    var upserted = false;
    if (lastRow > 1) {
      var ids = sh.getRange(2, idIdx + 1, lastRow - 1, 1).getValues();
      for (var r = 0; r < ids.length; r++) {
        if (String(ids[r][0]) === sessionId) {
          sh.getRange(r + 2, 1, 1, SESSION_LOG_HEADERS.length).setValues([rowArr]);
          upserted = true;
          break;
        }
      }
    }
    if (!upserted) sh.appendRow(rowArr);

    var result = {
      ok: true,
      sessionId: sessionId,
      // Read from rowObj, not the local: the freeze above may have kept the
      // already-forwarded row's stored pay instead of the recomputed figure.
      therapistPay: rowObj.therapistPay,
      clientSessionValue: clientSessionValue,
      sessionStatus: sessionStatus,
      creditStatus: rowObj.creditStatus
    };
    if (rowObj.creditsOwed !== undefined) result.creditsOwed = rowObj.creditsOwed;
    if (upserted) result.upserted = true; else result.appended = true;
    return result;
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function _recoverPhone(raw) {
  if (raw === null || raw === undefined) return '';
  var s = String(raw).replace(/[\s\-\(\)]/g, '');
  if (s.indexOf('+') === 0) s = s.slice(1);
  if (s.indexOf('00') === 0) s = s.slice(2);
  s = s.replace(/\D/g, '');
  if (!s) return '';
  if (s.indexOf('972') === 0) s = '0' + s.slice(3);   // intl -> local
  else if (s.charAt(0) !== '0') s = '0' + s;          // Sheets dropped the leading 0
  return s;
}

function _requestUser(payload) {
  return String(payload && payload.user != null ? payload.user : '')
    .replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, 40);
}

function _ss() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function _stampClientRowAt(clientsSh, rowNum, user) {
  var atCol = CLIENTS_HEADERS.indexOf('updatedAt') + 1;
  var byCol = CLIENTS_HEADERS.indexOf('updatedBy') + 1;
  if (atCol < 1 || byCol < 1 || rowNum < 2) return false;
  clientsSh.getRange(rowNum, atCol).setValue(new Date().toISOString());
  clientsSh.getRange(rowNum, byCol).setValue(String(user == null ? '' : user));
  return true;
}

function _therapistPay(therapistName, treatmentType) {
  var name = String(therapistName == null ? '' : therapistName).trim();
  var type = String(treatmentType == null ? '' : treatmentType).trim();
  // 1) Sheet-managed rates (TherapistRates) — the operational source of truth.
  var rates = null;
  try { rates = _loadTherapistRates(); } catch (_) { rates = null; }
  if (rates && _hasOwn(rates, name)) {
    var r = rates[name];
    if (!isNaN(r.flat) && r.flat > 0) return r.flat;
    if (type === 'אינטייק' && !isNaN(r.intake) && r.intake > 0) return r.intake;
    if (type === 'מעקב פסיכיאטרי' && !isNaN(r.followup) && r.followup > 0) return r.followup;
    throw new Error('Therapist "' + name + '" is in TherapistRates but has no usable rate for type "' + type + '"');
  }
  // 2) Fallback: hardcoded seed maps (resilience if the sheet/cache is unavailable).
  if (_hasOwn(THERAPIST_FLAT_RATES, name)) return THERAPIST_FLAT_RATES[name];
  if (_hasOwn(PSYCHIATRIST_RATES, name)) {
    var table = PSYCHIATRIST_RATES[name];
    if (!type || !_hasOwn(table, type)) {
      throw new Error('Psychiatrist "' + name + '" requires a valid treatmentType (אינטייק or מעקב פסיכיאטרי)');
    }
    return table[type];
  }
  // Fail-closed: never invent a pay rate.
  throw new Error('Unknown therapist: "' + name + '" — add a row to the TherapistRates sheet');
}

function _toCredits(v) {
  var n = parseInt(v, 10);
  return (isNaN(n) || n < 0) ? 0 : n;
}

function _toNumberOrZero(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  return isFinite(n) ? n : 0;
}

function _todayISODate() {
  return Utilities.formatDate(
    new Date(), Session.getScriptTimeZone() || 'Asia/Jerusalem', 'yyyy-MM-dd');
}

function _writeAll(sh, headers, rows) {
  _finGuardRewrite(sh, headers, rows || []);
  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  }
  if (!rows || !rows.length) return;
  var values = rows.map(function (row) {
    return headers.map(function (h) {
      var v = row[h];
      if (v === undefined || v === null) return '';
      return v;
    });
  });
  // Force phone + stamp columns to plain text BEFORE writing so leading zeros
  // and ISO timestamps survive (Sheets would otherwise coerce a numeric-looking
  // phone to a number and an ISO string to a Date).
  for (var c = 0; c < headers.length; c++) {
    if (_isTextForcedColumn(headers[c])) {
      sh.getRange(2, c + 1, values.length, 1).setNumberFormat('@');
    }
  }
  sh.getRange(2, 1, values.length, headers.length).setValues(values);
}

function _writeCreditsOwed(clientsSh, clientId, balance, user) {
  _finGuard([clientId]);
  var idCol = CLIENTS_HEADERS.indexOf('id') + 1;
  var creditCol = CLIENTS_HEADERS.indexOf('creditsOwed') + 1;
  var lastRow = clientsSh.getLastRow();
  if (lastRow < 2 || idCol < 1 || creditCol < 1 || !clientId) return false;
  var ids = clientsSh.getRange(2, idCol, lastRow - 1, 1).getValues();
  for (var r = 0; r < ids.length; r++) {
    if (String(ids[r][0]) === String(clientId)) {
      clientsSh.getRange(r + 2, creditCol).setValue(balance);
      _stampClientRowAt(clientsSh, r + 2, user);
      return true;
    }
  }
  return false;
}

function beginOutpatientRecovery() {
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty('OUTPATIENT_RECOVERY_HOLD', '1');
    // Freeze new admissions now, but do not authorize cutover while a job
    // admitted before this hold can still publish or update its sentinels.
    if (props.getProperty('INTEGRITY_ACTIVE_BACKUP')) return { ok: false, error: 'backup_draining', state: 'recovery_pending' };
    return { ok: true, state: 'recovery_pending' };
  } finally { lock.releaseLock(); }
}

function finishOutpatientRecovery(backupId, day, configVerified, manualPolicy) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('OUTPATIENT_RECOVERY_HOLD') !== '1') throw new Error('Recovery hold required');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    if (props.getProperty('INTEGRITY_ACTIVE_BACKUP')) throw new Error('Recovery backup still running');
    var backupSs = SpreadsheetApp.openById(backupId), targetSs = _ss();
    var result = _integrityVerifyRecoveredWorkbook(backupSs, day, targetSs, configVerified, manualPolicy);
    if (_ss().getSheetByName('FinancialOps')) _finJournal(); // Validate both operation kinds before reopening writers.
    try { CacheService.getScriptCache().remove('therapistRates_v1'); } catch (_) { throw new Error('Recovery rate cache invalidation failed'); }
    if (result.journalRequired) props.setProperty('FINANCIAL_OPS_CREATED', '1');
    else if (props.getProperty('FINANCIAL_OPS_CREATED')) throw new Error('Restore journal required');
    props.setProperty('INTEGRITY_REQUIRED_SOURCES', JSON.stringify(_ss().getSheets().map(function (sh) { return sh.getName(); })));
    // Repeat the proof after journal/cache/property work, as late as possible.
    // ScriptLock does not stop direct editors: the coordinated pause is required.
    if (manualPolicy) _integrityVerifyRecoveredWorkbook(backupSs, day, targetSs, configVerified, manualPolicy);
    // Clear LAST, only after all reads, schema checks and marker persistence.
    props.deleteProperty('OUTPATIENT_RECOVERY_HOLD');
    return { ok: true, state: 'verified' };
  } finally { lock.releaseLock(); }
}
      function check(ok, reason) { if (!ok) throw new Error(reason); }
      function rejected(fn, pattern) {
        var error = null; try { fn(); } catch (e) { error = String(e); }
        check(error && pattern.test(error), 'Expected refusal: ' + pattern);
      }
      function grid(name) { return currentBook.getSheetByName(name).getDataRange().getValues(); }
      function revive(rows) { return rows.map(function (row) { return row.map(function (v) {
        return v && typeof v === 'object' && v.drillDate ? new Date(v.drillDate) : v;
      }); }); }
      function seed(ss, tab, values, i) {
        // The actual verified writer supplies literal-string/type handling.
        _integrityWriteSnapshot(ss, 'outpatient-' + ('2099-01-' + ('0' + (i + 1)).slice(-2)), values).setName(tab);
      }
      function publish(day) {
        var items = _integrityCaptureData(books.source);
        var manifest = [['id', 'source', 'snapshot', 'absent', 'sha256']];
        items.forEach(function (item) {
          var snapshot = 'outpatient-' + item.prefix + day;
          _integrityWriteSnapshot(books.backup, snapshot, item.grid, item.formats);
          manifest.push([item.source, item.source, snapshot, item.absent ? '1' : '0', _integrityFingerprint(item.grid)]);
        });
        _integrityWriteSnapshot(books.backup, 'outpatient-manifest-' + day, manifest);
        return _integrityValidateRestoreSet(books.backup, day, true);
      }
      if (phase === 'prepare') {
        var initial = books.source.getSheets()[0];
        Object.keys(fixture.grids).forEach(function (tab, i) {
          seed(books.source, tab, revive(fixture.grids[tab]), i);
        });
        books.source.deleteSheet(initial);
        PropertiesService.getScriptProperties().setProperty('FINANCIAL_OPS_CREATED', '1');
        PropertiesService.getScriptProperties().setProperty('SESSION_OUTCOME_SECRET', fixture.event.secret);
        check(_finJournal().ops.length === 2, 'Both journal kinds must exist');
        check(grid('SessionLog').length === 3, 'Two nonempty session rows required');
        check(grid('PackageCatalog').length > 1 && grid('PackageRequests').length === 2, 'Package fixtures required');
        return { stage: 'prepared', detail: 'Synthetic sessions, both journal kinds, approved quote and typed audit values seeded' };
      }
      if (phase === 'capture') {
        var captured = publish(state.day);
        check(captured.length === 20, 'Expected 19 registered datasets plus metadata');
        check(captured.filter(function (x) { return x.source === 'FinancialOps'; })[0].grid.length === 3,
          'Journal history was omitted');
        return { stage: 'captured', detail: '20 manifest entries fingerprint-verified in native Sheets' };
      }
      if (phase === 'restore') {
        check(beginOutpatientRecovery().ok === true, 'Fixture recovery must be quiescent');
        var items = _integrityValidateRestoreSet(books.backup, state.day, true);
        var blank = books.target.getSheets()[0];
        check(books.target.getSheets().length === 1 && blank.getLastRow() === 0, 'Restore target must be fresh');
        items.forEach(function (item) {
          if (item.absent || item.source === '__RecoveryMetadata') return;
          var copy = books.backup.getSheetByName('outpatient-' + item.prefix + state.day).copyTo(books.target);
          copy.setName(item.source);
          _integrityVerifyGrid(item.grid, copy.getDataRange().getValues());
        });
        books.target.deleteSheet(blank);
        return { stage: 'restored', detail: 'Native copy into separate target; every restored grid matched' };
      }
      if (phase === 'verify') {
        rejected(function () { _integrityVerifyRecoveredWorkbook(books.backup, state.day, books.target, false); }, /configuration verification/);
        rejected(function () { _integrityVerifyRecoveredWorkbook(books.backup, state.day, books.source, true); }, /isolated target/);
        var sessions = books.target.getSheetByName('SessionLog');
        sessions.setName('_DrillMissingSessionLog');
        try { rejected(function () { _integrityVerifyRecoveredWorkbook(books.backup, state.day, books.target, true); }, /Recovered sheet missing/); }
        finally { sessions.setName('SessionLog'); }
        var journal = _finJournal().ops;
        check(journal.length === 2 && journal.some(function (op) { return JSON.parse(op.intent).kind === 'extra_charge'; }) &&
          journal.some(function (op) { return !JSON.parse(op.intent).kind; }), 'Mixed journal validation failed');
        check(finishOutpatientRecovery(books.backup.getId(), state.day, true).ok === true, 'Fixture finish failed');
        var before = { payments: _integrityFingerprint(grid('Payments')), charges: _integrityFingerprint(grid('ClientCharges')),
          journal: _integrityFingerprint(grid('FinancialOps')), clients: _integrityFingerprint(grid('Clients')) };
        check(_applyRenewal({ opId: fixture.renewalId }).ok === true, 'Renewal retry failed');
        check(_applyExtraCharge({ opId: fixture.extraId }).ok === true, 'Extra-charge retry failed');
        check(_recordSessionOutcome(fixture.event).ok === true, 'Cancellation retry failed');
        check(_recordSessionOutcome(fixture.paidEvent).ok === true, 'Paid-session retry failed');
        check(before.payments === _integrityFingerprint(grid('Payments')) && before.charges === _integrityFingerprint(grid('ClientCharges')) &&
          before.journal === _integrityFingerprint(grid('FinancialOps')) && before.clients === _integrityFingerprint(grid('Clients')),
          'Retry changed financial effects or patient balance');
        var rows = _readAll(books.target.getSheetByName('SessionLog'), SESSION_LOG_HEADERS);
        var paid = rows.filter(function (x) { return x.sessionId === fixture.paidEvent.sessionId; })[0];
        check(rows.length === 2 && paid.forwardedToPayroll === '2026-10' && Number(paid.therapistPay) === 777,
          'Replay lost payroll stamp or configured rate');
        _integrityVerifyGrid(revive(fixture.grids.AuditLog), grid('AuditLog'));
        _integrityVerifyGrid(fixture.grids.PackageCatalog, grid('PackageCatalog'));
        _integrityVerifyGrid(fixture.grids.PackageRequests, grid('PackageRequests'));
        Object.keys(fixture.grids).forEach(function (tab) {
          _integrityVerifyGrid(revive(fixture.grids[tab]), books.source.getSheetByName(tab).getDataRange().getValues());
        });
        return { stage: 'verified', detail: 'Native round-trip and exact retries passed; not production certification' };
      }
      // Preserve unknown/manual tabs faithfully, and prove that the gate still
      // refuses them. This does not whitelist the actual production archive.
      books.source.insertSheet('Sheet1');
      seed(books.source, 'Copy of Clients', [['id', 'note'], ['drill-archive', '=literal archive']], 25);
      var manualDay = '2099-12-31', manual = publish(manualDay);
      check(manual.length === 22, 'Manual inventory lost');
      ['Sheet1', 'Copy of Clients'].forEach(function (tab) {
        var item = manual.filter(function (x) { return x.source === tab; })[0];
        check(!!item && !item.absent, 'Manual source not preserved');
        _integrityVerifyGrid(books.source.getSheetByName(tab).getDataRange().getValues(), item.grid);
      });
      rejected(function () { _integrityVerifyRecoveredWorkbook(books.backup, manualDay, books.target, true); }, /Unclassified sheets/);
      return { stage: 'manual_block_verified', detail: 'Empty Sheet1 and synthetic archive preserved; certification correctly refused' };
    })(facade, propertyFacade);
    state.phase = result.stage; report('PASS', result.detail); saveState();
    Logger.log(JSON.stringify({ phase: phase, result: 'PASS', detail: result.detail,
      workbookIds: state.ids, sourceCodeSHA256: metadata.sourceCodeSHA256,
      helperSHA256: metadata.helperSHA256, drillDefinitionSHA256: metadata.drillDefinitionSHA256,
      durationMs: Date.now() - phaseStartedAt, productionCertified: false }));
    return { ok: true, phase: state.phase, workbookIds: state.ids, productionCertified: false };
  } catch (error) {
    state.failed = true;
    try { saveState(); report('FAIL', String(error).slice(0, 500)); }
    catch (reportError) { Logger.log('Drill evidence write failed: ' + String(reportError).slice(0, 200)); }
    throw error;
  } finally {
    lock.waitLock(30000);
    try { state.running = false; saveState(); }
    finally { lock.releaseLock(); }
  }
}
