-- CreateEnum
CREATE TYPE "ImportLogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportLogStage" AS ENUM ('FETCH_PAGE', 'PARSE_ITEM', 'AI_ASSIST', 'GEOCODE', 'AZIMUTH_HEURISTIC', 'CAMERA_CREATED', 'NEEDS_REVIEW', 'SKIPPED_ALREADY_RESOLVED', 'ERROR');

-- CreateEnum
CREATE TYPE "StreamType" AS ENUM ('IFRAME', 'HLS', 'MJPEG_SNAPSHOT', 'YOUTUBE_LIVE');

-- CreateEnum
CREATE TYPE "CameraConfidence" AS ENUM ('VERIFIED', 'ESTIMATED');

-- CreateEnum
CREATE TYPE "CameraLocationType" AS ENUM ('OUTDOOR', 'INDOOR', 'NATURE');

-- CreateEnum
CREATE TYPE "CameraStatus" AS ENUM ('ONLINE', 'DELAYED', 'OFFLINE', 'DISABLED_SECURITY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'GEOCODED', 'NEEDS_REVIEW', 'IMPORTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "MobilityType" AS ENUM ('STATIONARY', 'FIXED_ROUTE');

-- CreateEnum
CREATE TYPE "RouteMode" AS ENUM ('LOOP', 'TIMETABLE', 'LIVE_GPS');

-- CreateEnum
CREATE TYPE "IncidentType" AS ENUM ('ACCIDENT', 'ROAD_CLOSURE', 'FLOODING', 'ICE', 'FOG', 'CONSTRUCTION', 'OTHER');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('ACTIVE', 'RESOLVED');

-- CreateEnum
CREATE TYPE "HomeVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'NEEDS_REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "BorderDirection" AS ENUM ('UA_OUT', 'UA_IN');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('CAMERA_STATUS', 'AREA_INCIDENT');

-- CreateEnum
CREATE TYPE "CameraSubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "TelegramUser" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "username" TEXT,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelegramUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "City" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "region" TEXT,
    "countryCode" TEXT NOT NULL DEFAULT 'UA',
    "countryName" TEXT,
    "webcamGuruSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "City_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AggregatorSiteCandidate" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "cityId" TEXT,
    "estimatedCameraCount" INTEGER,
    "estimationMethod" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "AggregatorSiteCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraProvider" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "adapterKey" TEXT NOT NULL,
    "cityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Camera" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "streamUrl" TEXT NOT NULL,
    "streamType" "StreamType" NOT NULL,
    "locationType" "CameraLocationType" NOT NULL DEFAULT 'OUTDOOR',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "azimuth" DOUBLE PRECISION NOT NULL,
    "azimuthSource" TEXT,
    "fovAngle" DOUBLE PRECISION NOT NULL,
    "rangeMeters" INTEGER NOT NULL,
    "heightMeters" DOUBLE PRECISION,
    "confidence" "CameraConfidence" NOT NULL DEFAULT 'ESTIMATED',
    "status" "CameraStatus" NOT NULL DEFAULT 'UNKNOWN',
    "delaySeconds" INTEGER,
    "lastCheckedAt" TIMESTAMP(3),
    "lastSnapshotHash" TEXT,
    "district" TEXT,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "cityId" TEXT,
    "mobilityType" "MobilityType" NOT NULL DEFAULT 'STATIONARY',
    "routeGeometry" JSONB,
    "routeLengthMeters" DOUBLE PRECISION,
    "routeMode" "RouteMode",
    "routeSchedule" JSONB,
    "averageSpeed" DOUBLE PRECISION,
    "routeStartedAt" TIMESTAMP(3),
    "currentOffsetMeters" DOUBLE PRECISION,
    "currentAzimuth" DOUBLE PRECISION,
    "liveGpsLat" DOUBLE PRECISION,
    "liveGpsLng" DOUBLE PRECISION,
    "liveGpsSpeed" DOUBLE PRECISION,
    "liveGpsUpdatedAt" TIMESTAMP(3),
    "fov_polygon" geometry(Polygon, 4326),
    "route_buffer_polygon" geometry(Polygon, 4326),
    "route_line" geometry(LineString, 4326),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAutoCalibrationAttemptAt" TIMESTAMP(3),
    "autoCalibrationAttemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAiCalibrationSuggestion" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camera_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraSourceRaw" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "sourcePageUrl" TEXT NOT NULL,
    "rawTitle" TEXT NOT NULL,
    "rawLocationText" TEXT,
    "rawStreamUrl" TEXT,
    "guessedLat" DOUBLE PRECISION,
    "guessedLng" DOUBLE PRECISION,
    "geocodeConfidence" DOUBLE PRECISION,
    "importStatus" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "cameraId" TEXT,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedByTelegramId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,

    CONSTRAINT "CameraSourceRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParserRunLog" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "discoveredCount" INTEGER NOT NULL DEFAULT 0,
    "newCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "geocodedCount" INTEGER NOT NULL DEFAULT 0,
    "autoImportedCount" INTEGER NOT NULL DEFAULT 0,
    "needsReviewCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "anomalyFlag" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ParserRunLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportLogEntry" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" "ImportLogLevel" NOT NULL,
    "stage" "ImportLogStage" NOT NULL,
    "externalId" TEXT,
    "cameraSourceRawId" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "ImportLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadIncident" (
    "id" TEXT NOT NULL,
    "type" "IncidentType" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "IncidentStatus" NOT NULL DEFAULT 'ACTIVE',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "reportedByTelegramId" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RoadIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeAddressVerification" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "claimedAddress" TEXT NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "status" "HomeVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "receiptImageUrl" TEXT,
    "adminExempt" BOOLEAN NOT NULL DEFAULT false,
    "extractedAddress" TEXT,
    "addressMatchConfidence" DOUBLE PRECISION,
    "handwrittenDateText" TEXT,
    "handwrittenDateIsRecent" BOOLEAN,
    "looksGenuine" BOOLEAN,
    "aiNotes" TEXT,
    "aiRawResponse" JSONB,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByTelegramId" TEXT,
    "rejectionReason" TEXT,

    CONSTRAINT "HomeAddressVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorderCrossing" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "countryFrom" TEXT NOT NULL,
    "countryTo" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorderCrossing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BorderWaitReport" (
    "id" TEXT NOT NULL,
    "crossingId" TEXT NOT NULL,
    "direction" "BorderDirection" NOT NULL,
    "waitMinutes" INTEGER NOT NULL,
    "reportedByTelegramId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BorderWaitReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertSubscription" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "cameraId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "radiusMeters" INTEGER,
    "label" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastCameraStatus" TEXT,
    "lastNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareLink" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "cityId" TEXT,
    "createdByTelegramId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CameraSubmission" (
    "id" TEXT NOT NULL,
    "streamUrl" TEXT NOT NULL,
    "suggestedName" TEXT,
    "cityId" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "address" TEXT,
    "description" TEXT,
    "submittedByTelegramId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "status" "CameraSubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "createdCameraId" TEXT,
    "reviewedByTelegramId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CameraSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GrokBatchJob" (
    "id" TEXT NOT NULL,
    "xaiBatchId" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestMap" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "GrokBatchJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoTargetZone" (
    "id" TEXT NOT NULL,
    "geom" JSONB NOT NULL,
    "kind" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoTargetZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BtwLockEvent" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "targetCell" TEXT NOT NULL,
    "cameraId" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BtwLockEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BtwRefineEvent" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BtwRefineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BtwViewpoint" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "heading" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BtwViewpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BtwDevLocationOverride" (
    "telegramId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BtwDevLocationOverride_pkey" PRIMARY KEY ("telegramId")
);

-- CreateTable
CREATE TABLE "BtwReport" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "cameraId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BtwReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BtwTelemetryEvent" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "scans" INTEGER NOT NULL,
    "withCandidates" INTEGER NOT NULL,
    "locks" INTEGER NOT NULL,
    "snapUsed" BOOLEAN NOT NULL,
    "fallbackOffered" INTEGER NOT NULL DEFAULT 0,
    "fallbackUsed" INTEGER NOT NULL DEFAULT 0,
    "scanErrors" INTEGER NOT NULL DEFAULT 0,
    "camerasInBboxLast" INTEGER NOT NULL DEFAULT 0,
    "coneSurvivorsLast" INTEGER NOT NULL DEFAULT 0,
    "streetCandidatesFoundLast" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BtwTelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUser_telegramId_key" ON "TelegramUser"("telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "City_slug_key" ON "City"("slug");

-- CreateIndex
CREATE INDEX "City_slug_idx" ON "City"("slug");

-- CreateIndex
CREATE INDEX "City_countryCode_idx" ON "City"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "AggregatorSiteCandidate_url_key" ON "AggregatorSiteCandidate"("url");

-- CreateIndex
CREATE INDEX "AggregatorSiteCandidate_cityId_idx" ON "AggregatorSiteCandidate"("cityId");

-- CreateIndex
CREATE INDEX "AggregatorSiteCandidate_status_idx" ON "AggregatorSiteCandidate"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CameraProvider_adapterKey_key" ON "CameraProvider"("adapterKey");

-- CreateIndex
CREATE INDEX "Camera_cityId_idx" ON "Camera"("cityId");

-- CreateIndex
CREATE INDEX "Camera_deletedAt_idx" ON "Camera"("deletedAt");

-- CreateIndex
CREATE INDEX "CameraSourceRaw_importStatus_scrapedAt_idx" ON "CameraSourceRaw"("importStatus", "scrapedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CameraSourceRaw_providerId_externalId_key" ON "CameraSourceRaw"("providerId", "externalId");

-- CreateIndex
CREATE INDEX "ParserRunLog_providerId_startedAt_idx" ON "ParserRunLog"("providerId", "startedAt");

-- CreateIndex
CREATE INDEX "ImportLogEntry_runId_timestamp_idx" ON "ImportLogEntry"("runId", "timestamp");

-- CreateIndex
CREATE INDEX "ImportLogEntry_providerId_timestamp_idx" ON "ImportLogEntry"("providerId", "timestamp");

-- CreateIndex
CREATE INDEX "ImportLogEntry_level_timestamp_idx" ON "ImportLogEntry"("level", "timestamp");

-- CreateIndex
CREATE INDEX "RoadIncident_status_reportedAt_idx" ON "RoadIncident"("status", "reportedAt");

-- CreateIndex
CREATE INDEX "HomeAddressVerification_telegramId_submittedAt_idx" ON "HomeAddressVerification"("telegramId", "submittedAt");

-- CreateIndex
CREATE INDEX "HomeAddressVerification_status_idx" ON "HomeAddressVerification"("status");

-- CreateIndex
CREATE INDEX "HomeAddressVerification_ipAddress_submittedAt_idx" ON "HomeAddressVerification"("ipAddress", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BorderCrossing_slug_key" ON "BorderCrossing"("slug");

-- CreateIndex
CREATE INDEX "BorderCrossing_slug_idx" ON "BorderCrossing"("slug");

-- CreateIndex
CREATE INDEX "BorderWaitReport_crossingId_direction_reportedAt_idx" ON "BorderWaitReport"("crossingId", "direction", "reportedAt");

-- CreateIndex
CREATE INDEX "BorderWaitReport_ipAddress_reportedAt_idx" ON "BorderWaitReport"("ipAddress", "reportedAt");

-- CreateIndex
CREATE INDEX "AlertSubscription_telegramId_idx" ON "AlertSubscription"("telegramId");

-- CreateIndex
CREATE INDEX "AlertSubscription_type_active_idx" ON "AlertSubscription"("type", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ShareLink_slug_key" ON "ShareLink"("slug");

-- CreateIndex
CREATE INDEX "ShareLink_slug_idx" ON "ShareLink"("slug");

-- CreateIndex
CREATE INDEX "CameraSubmission_status_submittedAt_idx" ON "CameraSubmission"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "CameraSubmission_ipAddress_submittedAt_idx" ON "CameraSubmission"("ipAddress", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "GrokBatchJob_xaiBatchId_key" ON "GrokBatchJob"("xaiBatchId");

-- CreateIndex
CREATE INDEX "GrokBatchJob_status_idx" ON "GrokBatchJob"("status");

-- CreateIndex
CREATE INDEX "NoTargetZone_kind_idx" ON "NoTargetZone"("kind");

-- CreateIndex
CREATE INDEX "BtwLockEvent_telegramId_targetCell_createdAt_idx" ON "BtwLockEvent"("telegramId", "targetCell", "createdAt");

-- CreateIndex
CREATE INDEX "BtwRefineEvent_telegramId_createdAt_idx" ON "BtwRefineEvent"("telegramId", "createdAt");

-- CreateIndex
CREATE INDEX "BtwViewpoint_telegramId_idx" ON "BtwViewpoint"("telegramId");

-- CreateIndex
CREATE INDEX "BtwTelemetryEvent_telegramId_idx" ON "BtwTelemetryEvent"("telegramId");

-- CreateIndex
CREATE INDEX "BtwTelemetryEvent_createdAt_idx" ON "BtwTelemetryEvent"("createdAt");

-- AddForeignKey
ALTER TABLE "AggregatorSiteCandidate" ADD CONSTRAINT "AggregatorSiteCandidate_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraProvider" ADD CONSTRAINT "CameraProvider_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "CameraProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Camera" ADD CONSTRAINT "Camera_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "City"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CameraSourceRaw" ADD CONSTRAINT "CameraSourceRaw_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "CameraProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParserRunLog" ADD CONSTRAINT "ParserRunLog_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "CameraProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLogEntry" ADD CONSTRAINT "ImportLogEntry_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ParserRunLog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportLogEntry" ADD CONSTRAINT "ImportLogEntry_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "CameraProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BorderWaitReport" ADD CONSTRAINT "BorderWaitReport_crossingId_fkey" FOREIGN KEY ("crossingId") REFERENCES "BorderCrossing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
