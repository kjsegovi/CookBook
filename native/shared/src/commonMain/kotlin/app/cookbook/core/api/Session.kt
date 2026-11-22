package app.cookbook.core.api

import io.github.jan.supabase.auth.Auth
import io.github.jan.supabase.auth.auth
import io.github.jan.supabase.auth.providers.builtin.Email
import io.github.jan.supabase.auth.exception.NoSessionFoundException
import io.github.jan.supabase.auth.user.UserSession
import io.github.jan.supabase.auth.SessionManager
import io.github.jan.supabase.createSupabaseClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

interface Session {
    suspend fun accessToken(): String?
    val userId: StateFlow<String?>
    suspend fun signIn(email: String, password: String)
    suspend fun signOut()
    suspend fun sendPasswordReset(email: String)
}

/** A tiny persistent string slot for the saved sign-in. Android: SharedPreferences, iOS: Keychain, tests: memory. */
interface SessionStorage {
    suspend fun load(): String?
    suspend fun save(value: String)
    suspend fun clear()
}

class InMemorySessionStorage : SessionStorage {
    private var value: String? = null
    override suspend fun load() = value
    override suspend fun save(value: String) { this.value = value }
    override suspend fun clear() { value = null }
}

private class StorageSessionManager(private val storage: SessionStorage) : SessionManager {
    override suspend fun saveSession(session: UserSession) = storage.save(Json.encodeToString(UserSession.serializer(), session))
    override suspend fun loadSession(): UserSession =
        storage.load()?.let { runCatching { Json.decodeFromString(UserSession.serializer(), it) }.getOrNull() }
            ?: throw NoSessionFoundException()
    override suspend fun deleteSession() = storage.clear()
}

/** Supabase Auth; the library keeps the token fresh and saves it through [storage]. */
class SupabaseSession(config: BackendConfig, storage: SessionStorage) : Session {
    private val client = createSupabaseClient(config.supabaseUrl, config.publishableKey) {
        install(Auth) { sessionManager = StorageSessionManager(storage) }
    }
    private val auth get() = client.auth
    private val redirect = config.publicAppUrl
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val user = MutableStateFlow<String?>(null)
    override val userId: StateFlow<String?> = user.asStateFlow()

    init {
        scope.launch { auth.sessionStatus.collect { user.value = auth.currentUserOrNull()?.id } }
    }

    override suspend fun accessToken(): String? {
        auth.awaitInitialization()
        return auth.currentAccessTokenOrNull()
    }

    override suspend fun signIn(email: String, password: String) {
        auth.signInWith(Email) { this.email = email; this.password = password }
        user.value = auth.currentUserOrNull()?.id
    }

    override suspend fun signOut() {
        // Offline the server can't be told; the saved sign-in is still forgotten on this device.
        try { auth.signOut() } catch (e: CancellationException) { throw e } catch (e: Exception) { auth.clearSession() }
        user.value = null
    }

    override suspend fun sendPasswordReset(email: String) = auth.resetPasswordForEmail(email, redirect)
}
