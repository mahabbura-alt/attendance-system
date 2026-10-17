package com.omos.safety

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.omos.safety.ui.OmosTheme
import com.omos.safety.ui.screens.ChangePasswordScreen
import com.omos.safety.ui.screens.ChecklistScreen
import com.omos.safety.ui.screens.DelegatorScreen
import com.omos.safety.ui.screens.Drafts
import com.omos.safety.ui.screens.EventFormScreen
import com.omos.safety.ui.screens.ForgotScreen
import com.omos.safety.ui.screens.HazardDraft
import com.omos.safety.ui.screens.HazardFormScreen
import com.omos.safety.ui.screens.HazardReviewScreen
import com.omos.safety.ui.screens.HistoryScreen
import com.omos.safety.ui.screens.HomeScreen
import com.omos.safety.ui.screens.IncidentScreen
import com.omos.safety.ui.screens.InspectionStartScreen
import com.omos.safety.ui.screens.LoginScreen
import com.omos.safety.ui.screens.MeetingScreen
import com.omos.safety.ui.screens.NotificationsScreen
import com.omos.safety.ui.screens.OutboxScreen
import com.omos.safety.ui.screens.PicInboxScreen
import com.omos.safety.ui.screens.PicRequestScreen
import com.omos.safety.ui.screens.ProfileScreen
import com.omos.safety.ui.screens.R
import com.omos.safety.ui.screens.ReportDetailScreen
import com.omos.safety.ui.screens.SavedScreen
import com.omos.safety.ui.screens.SchedulesScreen
import com.omos.safety.ui.screens.StatsScreen
import com.omos.safety.ui.screens.UpdateRequiredScreen
import com.omos.safety.ui.screens.VerifyScreen
import com.omos.safety.update.UpdateManager
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val openTarget = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        openTarget.value = intent?.getStringExtra("open")
        val repo = App.repo(this)
        setContent {
            var dark by remember { mutableStateOf(repo.session.darkMode) }
            OmosTheme(dark) {
                Root(openTarget.value, onConsumed = { openTarget.value = null }, dark = dark, onDark = { dark = it; repo.session.darkMode = it })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        openTarget.value = intent.getStringExtra("open")
    }
}

@Composable
private fun Root(open: String?, onConsumed: () -> Unit, dark: Boolean, onDark: (Boolean) -> Unit) {
    val ctx = LocalContext.current
    val repo = remember { App.repo(ctx) }
    val session by repo.session.state.collectAsState()
    val scope = rememberCoroutineScope()
    var gate by remember { mutableStateOf<UpdateManager.State?>(null) }
    val notifPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

    suspend fun checkMandatory() {
        repo.appVersion().onSuccess { v ->
            if (v.available == true && UpdateManager.isMandatory(v)) {
                gate = UpdateManager.State.Downloading(v)
                gate = UpdateManager.download(ctx, v)
            } else gate = null
        }
    }
    LaunchedEffect(Unit) { if (Build.VERSION.SDK_INT >= 33) notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS) }
    // Manifest versi butuh login (endpoint terautentikasi) → dicek setiap kali sesi aktif.
    LaunchedEffect(session.loggedIn, session.expired) { if (session.loggedIn && !session.expired) checkMandatory() }

    gate?.let { UpdateRequiredScreen(it) { scope.launch { checkMandatory() } }; return }

    when {
        !session.loggedIn || session.expired -> AuthFlow(expired = session.expired)
        session.mustChangePassword -> ChangePasswordScreen(forced = true, onDone = {}, onBack = null)
        else -> MainNav(open, onConsumed, dark, onDark)
    }
}

@Composable
private fun AuthFlow(expired: Boolean) {
    val nav = rememberNavController()
    NavHost(nav, startDestination = R.LOGIN) {
        composable(R.LOGIN) { LoginScreen(onForgot = { nav.navigate(R.FORGOT) }, expiredNotice = expired) }
        composable(R.FORGOT) { ForgotScreen(onBack = { nav.popBackStack() }) }
    }
}

@Composable
private fun MainNav(open: String?, onConsumed: () -> Unit, dark: Boolean, onDark: (Boolean) -> Unit) {
    val ctx = LocalContext.current
    val repo = remember { App.repo(ctx) }
    val nav = rememberNavController()
    LaunchedEffect(open) {
        if (open == "notifications") { nav.navigate(R.NOTIFICATIONS); onConsumed() }
    }
    val tab: (String) -> Unit = { route -> nav.navigateTab(route) }
    val saved: (String) -> Unit = { uuid -> nav.navigate("${R.SAVED}/$uuid") { popUpTo(R.HOME) } }
    NavHost(nav, startDestination = R.HOME) {
        composable(R.HOME) { HomeScreen(nav = { r -> if (r == R.HAZARD) { if (Drafts.hazard.mode != "create") Drafts.hazard = HazardDraft(); nav.navigate(r) } else nav.navigate(r) }) }
        composable(R.HAZARD) { HazardFormScreen(onBack = { nav.popBackStack() }, onNext = { nav.navigate(R.HAZARD_REVIEW) }) }
        composable(R.HAZARD_REVIEW) { HazardReviewScreen(onBack = { nav.popBackStack() }, onSaved = saved) }
        composable("${R.SAVED}/{uuid}") { e ->
            SavedScreen(e.arguments?.getString("uuid") ?: "", onHome = { nav.navigateTab(R.HOME) },
                onAgain = { route -> nav.navigate(route) { popUpTo(R.HOME) } }, onOutbox = { nav.navigate(R.OUTBOX) })
        }
        composable(R.INCIDENT) { IncidentScreen(onBack = { nav.popBackStack() }, onSaved = saved) }
        composable(R.INSPECTION) {
            InspectionStartScreen(onBack = { nav.popBackStack() }, onSchedules = { nav.navigate(R.SCHEDULES) },
                onStart = { t, l, s -> nav.navigate("${R.CHECKLIST}/$t/$l?schedule=${s ?: ""}") })
        }
        composable(R.SCHEDULES) {
            SchedulesScreen(onBack = { nav.popBackStack() }, onStart = { s ->
                nav.navigate("${R.CHECKLIST}/${s.templateId}/${s.locationId ?: "-"}?schedule=${s.id}")
            })
        }
        composable("${R.CHECKLIST}/{t}/{l}?schedule={s}") { e ->
            val a = e.arguments
            ChecklistScreen(a?.getString("t") ?: "", a?.getString("l") ?: "", a?.getString("s")?.ifBlank { null },
                onBack = { nav.popBackStack() }, onSaved = saved)
        }
        composable(R.P5M) { EventFormScreen("p5m", onBack = { nav.popBackStack() }, onSaved = saved) }
        composable(R.SAFETYTALK) { EventFormScreen("safetytalk", onBack = { nav.popBackStack() }, onSaved = saved) }
        composable(R.MEETING) { MeetingScreen(onBack = { nav.popBackStack() }, onSaved = saved) }
        composable(R.PIC) { PicInboxScreen(onBack = { nav.popBackStack() }, onRequest = { id, mode -> nav.navigate("${R.PIC_REQUEST}/$id/$mode") }) }
        composable("${R.PIC_REQUEST}/{id}/{mode}") { e -> PicRequestScreen(e.arguments?.getString("id") ?: "", e.arguments?.getString("mode") ?: "REASSIGN", onBack = { nav.popBackStack() }, onSent = { nav.popBackStack() }) }
        composable(R.VERIFY) { VerifyScreen(onBack = { nav.popBackStack() }) }
        composable(R.DELEGATOR) { DelegatorScreen(onBack = { nav.popBackStack() }) }
        composable(R.HISTORY) { HistoryScreen(nav = { r -> if (r in TABS) tab(r) else nav.navigate(r) }) }
        composable("${R.REPORT}/{id}") { e ->
            ReportDetailScreen(e.arguments?.getString("id") ?: "", onBack = { nav.popBackStack() }, onCorrect = { nav.navigate(R.HAZARD) })
        }
        composable(R.OUTBOX) { OutboxScreen(onBack = { nav.popBackStack() }, onRelogin = { repo.session.markExpired() }) }
        composable(R.NOTIFICATIONS) {
            NotificationsScreen(onBack = { nav.popBackStack() }, onOpen = { type, id ->
                when (type) {
                    "HAZARD" -> if (id != null) nav.navigate("${R.REPORT}/$id")
                    "PIC_REQUEST" -> nav.navigate(R.DELEGATOR)
                }
            })
        }
        composable(R.STATS) { StatsScreen(nav = { r -> if (r in TABS) tab(r) else nav.navigate(r) }) }
        composable(R.PROFILE) { ProfileScreen(nav = { r -> if (r in TABS) tab(r) else nav.navigate(r) }, darkMode = dark, onDarkMode = onDark) }
        composable(R.CHANGE_PASS) { ChangePasswordScreen(forced = false, onDone = { nav.popBackStack() }, onBack = { nav.popBackStack() }) }
    }
}

private val TABS = setOf(R.HOME, R.HISTORY, R.STATS, R.PROFILE)

private fun NavHostController.navigateTab(route: String) {
    if (route == R.HAZARD) { navigate(route); return }
    navigate(route) {
        popUpTo(R.HOME) { saveState = false }
        launchSingleTop = true
    }
}
