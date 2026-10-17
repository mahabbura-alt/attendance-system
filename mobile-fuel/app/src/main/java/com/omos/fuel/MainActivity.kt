package com.omos.fuel

import android.Manifest
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
import com.omos.fuel.ui.OmosTheme
import com.omos.fuel.ui.screens.AccountScreen
import com.omos.fuel.ui.screens.ChangePinScreen
import com.omos.fuel.ui.screens.CloseShiftScreen
import com.omos.fuel.ui.screens.FillScreen
import com.omos.fuel.ui.screens.HistoryScreen
import com.omos.fuel.ui.screens.HomeScreen
import com.omos.fuel.ui.screens.LoginScreen
import com.omos.fuel.ui.screens.ManualPickScreen
import com.omos.fuel.ui.screens.OpenShiftScreen
import com.omos.fuel.ui.screens.OpnameScreen
import com.omos.fuel.ui.screens.Purpose
import com.omos.fuel.ui.screens.R
import com.omos.fuel.ui.screens.ReceiptScreen
import com.omos.fuel.ui.screens.SavedScreen
import com.omos.fuel.ui.screens.ScanScreen
import com.omos.fuel.ui.screens.TransferScreen
import com.omos.fuel.ui.screens.UpdateRequiredScreen
import com.omos.fuel.update.UpdateManager
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val repo = App.repo(this)
        setContent {
            var dark by remember { mutableStateOf(repo.session.darkMode) }
            var contrast by remember { mutableStateOf(repo.session.highContrast) }
            OmosTheme(dark, contrast) {
                Root(dark, { dark = it; repo.session.darkMode = it }, contrast, { contrast = it; repo.session.highContrast = it })
            }
        }
    }
}

@Composable
private fun Root(dark: Boolean, onDark: (Boolean) -> Unit, contrast: Boolean, onContrast: (Boolean) -> Unit) {
    val ctx = LocalContext.current
    val repo = remember { App.repo(ctx) }
    val session by repo.session.state.collectAsState()
    val scope = rememberCoroutineScope()
    var gate by remember { mutableStateOf<UpdateManager.State?>(null) }
    val notif = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    val location = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}

    suspend fun checkMandatory() {
        repo.appVersion().onSuccess { v ->
            if (v.available == true && UpdateManager.isMandatory(v)) {
                gate = UpdateManager.State.Downloading(v)
                gate = UpdateManager.download(ctx, v)
            } else gate = null
        }
    }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33) notif.launch(Manifest.permission.POST_NOTIFICATIONS)
        // GPS hanya metadata foto (opsional); ditolak pun aplikasi tetap jalan.
        location.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
        checkMandatory()
    }

    gate?.let { UpdateRequiredScreen(it) { scope.launch { checkMandatory() } }; return }

    when {
        !session.loggedIn || session.expired -> LoginScreen(expired = session.expired)
        session.mustChangePin -> ChangePinScreen(forced = true, onDone = {}, onBack = null)
        else -> MainNav(dark, onDark, contrast, onContrast)
    }
}

@Composable
private fun MainNav(dark: Boolean, onDark: (Boolean) -> Unit, contrast: Boolean, onContrast: (Boolean) -> Unit) {
    val nav = rememberNavController()
    val go: (String) -> Unit = { route -> nav.navigateTab(route) }
    val saved: (String) -> Unit = { uuid -> nav.navigate("${R.SAVED}/$uuid") { popUpTo(R.HOME) } }
    val scan: (String) -> Unit = { purpose -> nav.navigate("${R.SCAN}/$purpose") }
    NavHost(nav, startDestination = R.HOME) {
        composable(R.HOME) { HomeScreen(nav = { r -> if (r in TABS) go(r) else nav.navigate(r) }) }
        composable("${R.SCAN}/{purpose}") { e ->
            val purpose = e.arguments?.getString("purpose") ?: Purpose.UNIT
            ScanScreen(purpose, onBack = { nav.popBackStack() },
                onUnit = { nav.navigate(R.FILL) { popUpTo("${R.SCAN}/{purpose}") { inclusive = true } } },
                onManual = { nav.navigate(R.MANUAL) })
        }
        composable(R.MANUAL) {
            ManualPickScreen(onBack = { nav.popBackStack() }, onPicked = { nav.navigate(R.FILL) { popUpTo(R.HOME) } })
        }
        composable(R.FILL) { FillScreen(onBack = { nav.popBackStack() }, onSaved = saved) }
        composable("${R.SAVED}/{uuid}") { e ->
            SavedScreen(e.arguments?.getString("uuid") ?: "", onAgain = { nav.navigate("${R.SCAN}/${Purpose.UNIT}") { popUpTo(R.HOME) } },
                onHome = { go(R.HOME) })
        }
        composable(R.TRANSFER) { TransferScreen(onBack = { nav.popBackStack() }, onScan = scan, onSaved = saved) }
        composable(R.RECEIPT) { ReceiptScreen(onBack = { nav.popBackStack() }, onScan = scan, onSaved = saved) }
        composable(R.OPNAME) { OpnameScreen(onBack = { nav.popBackStack() }, onScan = scan, onSaved = saved) }
        composable(R.OPEN_SHIFT) { OpenShiftScreen(onBack = { nav.popBackStack() }, onSaved = saved) }
        composable(R.CLOSE_SHIFT) { CloseShiftScreen(onBack = { nav.popBackStack() }, onSaved = saved) }
        composable(R.HISTORY) { HistoryScreen(nav = { r -> if (r in TABS) go(r) else nav.navigate(r) }) }
        composable(R.ACCOUNT) { AccountScreen(nav = { r -> if (r in TABS) go(r) else nav.navigate(r) }, dark, onDark, contrast, onContrast) }
        composable(R.CHANGE_PIN) { ChangePinScreen(forced = false, onDone = { nav.popBackStack() }, onBack = { nav.popBackStack() }) }
    }
}

private val TABS = setOf(R.HOME, R.HISTORY, R.ACCOUNT)

private fun NavHostController.navigateTab(route: String) {
    navigate(route) {
        popUpTo(R.HOME) { saveState = false }
        launchSingleTop = true
    }
}
