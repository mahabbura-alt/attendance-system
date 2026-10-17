package com.omos.safety.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Checklist
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material.icons.filled.Forum
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material.icons.filled.LocalHospital
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.omos.safety.data.ActionRow
import com.omos.safety.data.CacheKey
import com.omos.safety.data.DelegatorInbox
import com.omos.safety.data.Schedules
import com.omos.safety.data.Stats
import com.omos.safety.ui.Type
import com.omos.safety.ui.p
import com.omos.safety.ui.rememberCache
import com.omos.safety.ui.rememberRepo

object R {
    const val LOGIN = "login"; const val FORGOT = "forgot"; const val CHANGE_PASS = "change_password"
    const val HOME = "home"; const val HAZARD = "hazard"; const val HAZARD_REVIEW = "hazard_review"
    const val SAVED = "saved"; const val INCIDENT = "incident"; const val INSPECTION = "inspection"
    const val SCHEDULES = "schedules"; const val CHECKLIST = "checklist"; const val P5M = "p5m"
    const val SAFETYTALK = "safetytalk"; const val MEETING = "meeting"; const val PIC = "pic"
    const val PIC_REQUEST = "pic_request"; const val VERIFY = "verify"; const val DELEGATOR = "delegator"
    const val HISTORY = "history"; const val REPORT = "report"; const val OUTBOX = "outbox"
    const val NOTIFICATIONS = "notifications"; const val STATS = "stats"; const val PROFILE = "profile"
}

@Composable
fun HomeScreen(nav: (String) -> Unit) {
    val repo = rememberRepo()
    val boot by repo.observeBootstrap().collectAsState(initial = null)
    val session by repo.session.state.collectAsState()
    val pic by rememberCache<List<ActionRow>>(repo, CacheKey.PIC)
    val verify by rememberCache<List<ActionRow>>(repo, CacheKey.VERIFY)
    val delegator by rememberCache<DelegatorInbox>(repo, CacheKey.DELEGATOR)
    val schedules by rememberCache<Schedules>(repo, CacheKey.SCHEDULES)
    val stats by rememberCache<Stats>(repo, CacheKey.STATS)
    val unread by repo.observeUnread().collectAsState(initial = 0)
    val failed by repo.observeFailedCount().collectAsState(initial = 0)
    val pending by repo.observePendingCount().collectAsState(initial = 0)
    val sync by repo.sync.collectAsState()
    LaunchedEffect(Unit) { repo.refreshAll() }

    val me = boot?.me
    val picOpen = pic.orEmpty().count { it.actionStatus == "OPEN" || it.actionStatus == "IN_PROGRESS" }
    val delegatorCount = delegator?.let { (it.requests?.size ?: 0) + (it.stalled?.size ?: 0) } ?: 0
    val schedToday = schedules?.schedules.orEmpty().count { it.dueStatus == "TODAY" || it.dueStatus == "OVERDUE" }
    val hour = java.time.LocalTime.now(com.omos.safety.ui.WIB).hour
    val greeting = when (hour) { in 4..10 -> "Selamat pagi,"; in 11..14 -> "Selamat siang,"; in 15..17 -> "Selamat sore,"; else -> "Selamat malam," }

    com.omos.safety.ui.StatusBarIcons(darkBackground = true)
    Column(Modifier.fillMaxSize().background(p.bg)) {
        Column(Modifier.fillMaxWidth().background(p.header).statusBarsPadding().padding(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("OMOS Safety", style = Type.display, color = p.headerText, modifier = Modifier.weight(1f))
                val (label, bg, fg) = when {
                    failed > 0 -> Triple("${if (sync.online) "Online" else "Offline"} · $failed gagal", Color(0xFF3A2E10), Color(0xFFF8DC8A))
                    !sync.online -> Triple("Offline · $pending antre", Color(0xFF3A2E10), Color(0xFFF8DC8A))
                    pending > 0 -> Triple("Mengirim $pending…", Color(0xFF1F3A29), Color(0xFFB9F0C9))
                    else -> Triple("Online", Color(0xFF1F3A29), Color(0xFFB9F0C9))
                }
                Row(
                    Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(22.dp)).background(bg).clickable(role = Role.Button) { nav(R.OUTBOX) }
                        .padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Box(Modifier.size(8.dp).clip(CircleShape).background(if (sync.online) Color(0xFF4ADE80) else Color(0xFFF2B705)))
                    Spacer(Modifier.width(6.dp))
                    Text(label, style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = fg)
                }
                Spacer(Modifier.width(8.dp))
                Box(Modifier.size(48.dp)) {
                    Box(
                        Modifier.size(44.dp).align(Alignment.Center).clip(CircleShape).background(Color(0xFF26352C)).clickable(role = Role.Button) { nav(R.NOTIFICATIONS) }
                            .semantics { contentDescription = "Notifikasi, $unread belum dibaca" },
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Filled.Notifications, null, tint = Color.White) }
                    if (unread > 0) Text(
                        if (unread > 99) "99+" else "$unread", style = Type.tiny.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp), color = p.header,
                        modifier = Modifier.align(Alignment.TopEnd).clip(RoundedCornerShape(9.dp)).background(p.accent).padding(horizontal = 5.dp),
                    )
                }
            }
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(greeting, style = Type.small, color = p.headerMuted)
                Text(me?.nama ?: session.nama ?: "-", style = Type.display, color = p.headerText)
                Text("${me?.employeeId ?: session.employeeId ?: ""} · ${me?.jabatan ?: session.jabatan ?: ""} · ${me?.departemen ?: session.departemen ?: ""}", style = Type.small, color = p.headerMuted)
            }
            boot?.shift?.current?.let { s ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    HeaderChip(s.name ?: "Shift")
                    HeaderChip("Tgl operasional ${com.omos.safety.ui.fmtDate(s.operationalDate)}")
                }
            }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                Modifier.fillMaxWidth().height(60.dp).clip(RoundedCornerShape(14.dp)).background(p.accent).clickable(role = Role.Button) { nav(R.HAZARD) },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center,
            ) {
                Icon(Icons.Filled.Add, null, tint = Color(0xFF14201A))
                Spacer(Modifier.width(8.dp))
                Text("LAPOR HAZARD", style = Type.button.copy(fontSize = 20.sp), color = Color(0xFF14201A))
            }
            if (picOpen > 0) BannerCard(Icons.Filled.Inbox, "Laporan untuk Saya", "$picOpen hazard menunggu tindakan Anda sebagai PIC", p.amberBg, p.amber, p.amberText) { nav(R.PIC) }
            if (!me?.delegatorDepartments.isNullOrEmpty()) {
                val names = me?.delegatorDepartments.orEmpty().joinToString { it.departmentName ?: "-" }
                BannerCard(Icons.Filled.Groups, "Delegasi PIC · Dept. $names", if (delegatorCount > 0) "$delegatorCount perlu keputusan" else "Tidak ada permintaan", Color(0xFF14201A), p.accent, Color(0xFFC9D3CC), dark = true) { nav(R.DELEGATOR) }
            }
            val verifyCount = verify.orEmpty().size
            if (verifyCount > 0) BannerCard(Icons.Filled.Verified, "Perlu verifikasi", "$verifyCount bukti perbaikan menunggu Anda", p.purpleBg, p.purple, p.purple) { nav(R.VERIFY) }

            val tiles = listOf(
                Tile("Hazard Report", Icons.Filled.Warning, Color(0xFFFDEFC3), Color(0xFF8A6400), R.HAZARD),
                Tile("Inspeksi", Icons.Filled.Checklist, p.greenBg, p.green, R.INSPECTION, badge = if (schedToday > 0) "$schedToday jadwal hari ini" else null),
                Tile("P5M", Icons.Filled.Groups, p.blueBg, p.blue, R.P5M),
                Tile("Safety Talk / General", Icons.Filled.Forum, Color(0xFFF3E0D6), Color(0xFF8C3A12), R.SAFETYTALK),
                Tile("Pertemuan K3 / Umum", Icons.Filled.CalendarMonth, p.purpleBg, p.purple, R.MEETING),
                Tile("Insiden / Near Miss", Icons.Filled.LocalHospital, Color(0xFF8C1D18), Color.White, R.INCIDENT, danger = true),
            )
            tiles.chunked(3).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { row.forEach { TileView(it, Modifier.weight(1f)) { nav(it.route) } } }
            }
            stats?.let { st ->
                val rows = st.rows.orEmpty().filter { (it.target ?: 0) > 0 }
                val pct = if (rows.isEmpty()) 0 else rows.map { minOf(100, (100 * (it.actual ?: 0)) / maxOf(1, it.target ?: 1)) }.average().toInt()
                val met = rows.count { (it.actual ?: 0) >= (it.target ?: 0) }
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(p.surface).border(1.dp, p.border, RoundedCornerShape(14.dp))
                        .clickable(role = Role.Button) { nav(R.STATS) }.padding(14.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Row { Text("Pencapaian target saya", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.muted2, modifier = Modifier.weight(1f)); Text("Lihat detail ›", style = Type.small.copy(fontWeight = FontWeight.SemiBold), color = p.green) }
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text("$pct%", style = Type.display.copy(fontSize = 30.sp), color = p.ink)
                        Spacer(Modifier.width(10.dp))
                        Text(if (rows.isEmpty()) "Target belum diatur" else "$met dari ${rows.size} target tercapai", style = Type.small, color = p.muted2)
                    }
                    LinearProgressIndicator(progress = { pct / 100f }, modifier = Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(4.dp)), color = p.green, trackColor = p.border)
                }
            }
        }
        BottomBar(R.HOME, nav)
    }
}

@Composable
private fun HeaderChip(text: String) = Text(text, style = Type.small, color = Color(0xFFE5ECE7),
    modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Color(0xFF26352C)).padding(horizontal = 10.dp, vertical = 6.dp))

private data class Tile(val label: String, val icon: ImageVector, val bg: Color, val fg: Color, val route: String, val badge: String? = null, val danger: Boolean = false)

@Composable
private fun TileView(t: Tile, modifier: Modifier, onClick: () -> Unit) {
    Column(
        modifier.heightIn(min = 104.dp).clip(RoundedCornerShape(14.dp)).background(if (t.danger) p.redBg else p.surface)
            .border(if (t.danger) 1.5.dp else 1.dp, if (t.danger) Color(0xFFE5A29C) else p.border, RoundedCornerShape(14.dp))
            .clickable(role = Role.Button, onClick = onClick).padding(horizontal = 10.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(40.dp).clip(RoundedCornerShape(12.dp)).background(t.bg), contentAlignment = Alignment.Center) { Icon(t.icon, null, tint = t.fg) }
        Text(t.label, style = Type.small.copy(fontWeight = FontWeight.SemiBold, fontSize = 14.sp), color = p.ink)
        t.badge?.let {
            Text(it, style = Type.tiny.copy(fontWeight = FontWeight.Bold, fontSize = 11.sp), color = Color.White,
                modifier = Modifier.clip(RoundedCornerShape(999.dp)).background(p.green).padding(horizontal = 8.dp, vertical = 2.dp))
        }
    }
}

@Composable
private fun BannerCard(icon: ImageVector, title: String, sub: String, bg: Color, iconBg: Color, subColor: Color, dark: Boolean = false, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(bg).border(if (dark) 0.dp else 1.5.dp, if (dark) bg else iconBg, RoundedCornerShape(14.dp))
            .clickable(role = Role.Button, onClick = onClick).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(44.dp).clip(RoundedCornerShape(12.dp)).background(iconBg), contentAlignment = Alignment.Center) {
            Icon(icon, null, tint = if (dark) Color(0xFF14201A) else Color.White)
        }
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, style = Type.title, color = if (dark) Color.White else p.ink)
            Text(sub, style = Type.small, color = subColor)
        }
        Icon(Icons.Filled.ChevronRight, null, tint = if (dark) p.accent else subColor)
    }
}

@Composable
fun BottomBar(current: String, nav: (String) -> Unit) {
    HorizontalDivider(color = p.border)
    Row(Modifier.fillMaxWidth().background(p.surface).navigationBarsPadding().height(68.dp)) {
        listOf(
            Triple(R.HOME, "Beranda", Icons.Filled.Home),
            Triple(R.HAZARD, "Lapor", Icons.Filled.Add),
            Triple(R.HISTORY, "Riwayat", Icons.AutoMirrored.Filled.List),
            Triple(R.STATS, "Statistik", Icons.Filled.BarChart),
            Triple(R.PROFILE, "Profil", Icons.Filled.Person),
        ).forEach { (route, label, icon) ->
            val on = route == current
            Column(
                Modifier.weight(1f).fillMaxSize().clickable(role = Role.Tab) { if (!on) nav(route) },
                horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
            ) {
                Icon(icon, null, tint = if (on) p.green else p.muted)
                Text(label, style = Type.tiny.copy(fontWeight = if (on) FontWeight.SemiBold else FontWeight.Normal), color = if (on) p.green else p.muted)
            }
        }
    }
}
