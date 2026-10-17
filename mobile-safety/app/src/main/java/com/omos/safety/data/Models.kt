package com.omos.safety.data

// DTO respons API /api/hse/mobile/… — Gson memakai penamaan snake_case → camelCase.
// Semua field nullable karena Gson tidak memanggil konstruktor Kotlin (nilai default tidak berlaku).

data class LoginRequest(val employeeId: String, val password: String)

data class LoginUser(
    val id: String?, val nama: String?, val email: String?, val employeeId: String?,
    val jabatan: String?, val departemen: String?, val mustChangePassword: Boolean?, val role: String?,
)

data class LoginResponse(val token: String?, val user: LoginUser?)

data class MessageResponse(val message: String?, val error: String?)

data class Me(
    val id: String?, val nama: String?, val employeeId: String?, val jabatan: String?, val departemen: String?,
    val departmentId: String?, val positionId: String?, val isHse: Boolean?, val isAdmin: Boolean?,
    val delegatorDepartments: List<DeptRef>?,
)

data class DeptRef(val departmentId: String?, val departmentName: String?)

data class ShiftRef(val id: String?, val name: String?, val operationalDate: String?)
data class ShiftItem(val id: String?, val name: String?, val start: String?, val end: String?)
data class ShiftInfo(val current: ShiftRef?, val next: ShiftRef?, val list: List<ShiftItem>?)

data class OnDutyPerson(val id: String?, val nama: String?, val jabatan: String?, val phone: String?)
data class OnDuty(val current: List<OnDutyPerson>?, val next: List<OnDutyPerson>?)

data class EmergencyContact(val category: String?, val name: String?, val phoneNo: String?, val alternatePhone: String?)

data class SubArea(val id: String?, val name: String?)
data class Area(val id: String?, val name: String?, val subs: List<SubArea>?)

data class Category(val id: String?, val label: String?)
data class RiskRow(val kind: String?, val value: Int?, val label: String?, val description: String?, val color: String?)
data class Dept(val id: String?, val name: String?)
data class Employee(val id: String?, val nama: String?, val employeeId: String?, val departemen: String?, val jabatan: String?)

data class TemplateItem(val id: String?, val question: String?, val isCritical: Boolean?, val guidance: String?, val sortOrder: Int?)
data class InspectionTemplate(
    val id: String?, val rootId: String?, val code: String?, val name: String?, val inspectionType: String?,
    val objectType: String?, val scheduleCycle: String?, val items: List<TemplateItem>?,
)

data class StoragePolicy(
    val photoTargetKb: Int?, val sentPhotoRetentionDays: Int?, val lowStorageMb: Int?,
    val criticalStorageMb: Int?, val maxPhotosWhenCritical: Int?,
)

data class Bootstrap(
    val serverTime: String?, val masterVersion: String?, val me: Me?, val shift: ShiftInfo?,
    val hseOnDuty: OnDuty?, val emergencyContacts: List<EmergencyContact>?, val areas: List<Area>?,
    val categories: List<Category>?, val riskMatrix: List<RiskRow>?, val slaHours: Map<String, Int>?,
    val maxExtensions: Int?, val departments: List<Dept>?, val employees: List<Employee>?,
    val inspectionTemplates: List<InspectionTemplate>?, val storagePolicy: StoragePolicy?,
    val notificationPollMinutes: Int?,
)

data class SyncItem(val clientUuid: String, val type: String, val payload: Any)
data class SyncRequest(val items: List<SyncItem>)
data class SyncResult(
    val clientUuid: String?, val status: String?, val code: String?, val message: String?,
    val serverId: String?, val serverNo: String?, val recordStatus: String?, val duplicate: Boolean?,
)
data class SyncResponse(val results: List<SyncResult>?, val serverTime: String?)

/** Baris tindak lanjut (PIC, verifikasi, delegator). */
data class ActionRow(
    val actionId: String?, val actionNo: String?, val actionStatus: String?, val actionDescription: String?,
    val dueAt: String?, val dueDate: String?, val startedAt: String?, val completedAt: String?,
    val rejectedReason: String?, val rejectedAt: String?, val extensionCount: Int?, val evidenceUrl: List<String>?,
    val evidenceNote: String?, val picEmployeeId: String?, val picName: String?, val hazardId: String?,
    val reportNo: String?, val hazardStatus: String?, val riskLevel: String?, val description: String?,
    val categoryName: String?, val locationName: String?, val reportDate: String?, val reportTime: String?,
    val photos: List<String>?, val stopWork: Boolean?, val immediateAction: String?, val reportedByName: String?,
    val reportedBy: String?, val pendingRequestId: String?, val pendingRequestType: String?, val isOverdue: Boolean?,
    val potentialConsequence: String? = null, val recommendation: String? = null,
    /** Progres CAPA seluruh PIC pada hazard ini (status hazard close otomatis saat semua closed). */
    val capaTotal: Int? = null, val capaClosed: Int? = null,
    // khusus inbox delegator
    val requestId: String?, val requestType: String?, val reason: String?, val proposedDueDate: String?,
    val proposedDepartmentName: String?, val requesterName: String?, val requestedAt: String?, val departmentId: String?,
)

data class Candidate(val id: String?, val nama: String?, val jabatan: String?, val activeCount: Int?)
data class DelegatorInbox(
    val departments: List<DeptRef>?, val requests: List<ActionRow>?, val stalled: List<ActionRow>?,
    val candidates: Map<String, List<Candidate>>?, val forwardDepartments: List<Dept>?,
)

data class HazardSummary(
    val id: String?, val reportNo: String?, val status: String?, val riskLevel: String?, val description: String?,
    val categoryName: String?, val locationName: String?, val reportDate: String?, val stopWork: Boolean?,
    val isUrgent: Boolean?, val createdAt: String?, val revisionNo: Int?, val clientUuid: String?,
)
data class IncidentSummary(val id: String?, val incidentNo: String?, val incidentType: String?, val reportedCategory: String?,
    val status: String?, val description: String?, val locationName: String?, val occurredAt: String?, val clientUuid: String?)
data class InspectionSummary(val id: String?, val inspectionNo: String?, val templateName: String?, val locationName: String?,
    val findingsCount: Int?, val inspectedAt: String?, val okCount: Int?, val answeredCount: Int?, val clientUuid: String?)
data class EventSummary(val id: String?, val eventNo: String?, val eventDate: String?, val locationName: String?,
    val topics: List<String>?, val clientUuid: String?)
data class MeetingSummary(val id: String?, val meetingNo: String?, val meetingKind: String?, val title: String?,
    val meetingDate: String?, val locationName: String?, val clientUuid: String?)
data class MyReports(
    val hazards: List<HazardSummary>?, val incidents: List<IncidentSummary>?, val inspections: List<InspectionSummary>?,
    val p5m: List<EventSummary>?, val safetytalk: List<EventSummary>?, val meetings: List<MeetingSummary>?,
)

data class HazardEvent(val id: String?, val actionId: String?, val eventType: String?, val actorName: String?, val note: String?, val createdAt: String?)
data class HazardRevision(val revisionNo: Int?, val changedFields: List<String>?, val changedAt: String?)
data class DetailAction(
    val id: String?, val actionNo: String?, val picEmployeeId: String?, val picName: String?, val status: String?,
    val description: String?, val dueAt: String?, val dueDate: String?, val startedAt: String?, val completedAt: String?,
    val evidenceUrl: List<String>?, val evidenceNote: String?, val rejectedReason: String?, val extensionCount: Int?,
)
data class HazardFull(
    val id: String?, val reportNo: String?, val status: String?, val riskLevel: String?, val riskScore: Int?,
    val likelihood: Int?, val consequence: Int?, val description: String?, val categoryName: String?,
    val locationId: String?, val locationName: String?, val reportDate: String?, val reportTime: String?,
    val occurredAt: String?, val photos: List<String>?, val immediateAction: String?, val stopWork: Boolean?,
    val reportedBy: String?, val reportedByName: String?, val revisionNo: Int?, val cancelReason: String?,
    val potentialConsequence: String? = null, val recommendation: String? = null,
)
data class Permissions(val canCorrect: Boolean?, val canCancel: Boolean?, val canVerify: Boolean?, val canNote: Boolean?)
data class CapaProgress(val total: Int?, val closed: Int?, val waitingVerify: Int?, val inProgress: Int?, val open: Int?, val percent: Int?)
data class HazardDetail(
    val hazard: HazardFull?, val actions: List<DetailAction>?, val events: List<HazardEvent>?,
    val revisions: List<HazardRevision>?, val permissions: Permissions?, val capaProgress: CapaProgress? = null,
)

data class Schedule(
    val id: String?, val templateRootId: String?, val templateId: String?, val templateName: String?,
    val scheduleCycle: String?, val locationId: String?, val locationName: String?, val assetId: String?,
    val assigneeType: String?, val assigneePositionName: String?, val nextDueDate: String?, val lastDoneAt: String?,
    val notes: String?, val dueStatus: String?,
)
data class Schedules(val operationalDate: String?, val schedules: List<Schedule>?)

data class StatRow(
    val key: String?, val label: String?, val target: Int?, val actual: Int?,
    /** DAILY | WEEKLY | MONTHLY sesuai Setup Target; status WAJIB | BEBAS | BELUM_DIATUR | TIDAK_DISELEKSI. */
    val cycle: String? = null, val status: String? = null, val source: String? = null,
    val periodFrom: String? = null, val periodTo: String? = null,
)
data class Stats(val month: String?, val rows: List<StatRow>?, val note: String?)

data class RemoteNotification(
    val id: Long?, val kind: String?, val title: String?, val body: String?, val refType: String?, val refId: String?,
    val isUrgent: Boolean?, val readAt: String?, val createdAt: String?,
)
data class NotificationPage(val items: List<RemoteNotification>?, val unreadCount: Int?, val pollMinutes: Int?)

data class AppVersion(
    val available: Boolean?, val versionCode: Int?, val versionName: String?, val minimumSupportedVersion: Int?,
    val mandatory: Boolean?, val apkUrl: String?, val sha256: String?, val releaseNotes: List<String>?,
)
