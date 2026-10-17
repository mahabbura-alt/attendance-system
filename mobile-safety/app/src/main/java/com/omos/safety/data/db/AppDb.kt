package com.omos.safety.data.db

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

/** Status antrean per item (mockup: Menunggu / Mengirim / Terkirim / Gagal). */
object OutboxStatus {
    const val WAITING = "WAITING"
    const val SENDING = "SENDING"
    const val SENT = "SENT"
    const val FAILED = "FAILED"
}

@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey val clientUuid: String,
    val ownerUserId: String,
    val type: String,
    val module: String,
    val title: String,
    val payloadJson: String,
    val photoCount: Int,
    val isUrgent: Boolean,
    val createdAt: Long,
    val status: String = OutboxStatus.WAITING,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val serverId: String? = null,
    val serverNo: String? = null,
    val sentAt: Long? = null,
    /** Referensi lokal (mis. action_id / hazard_id) untuk menampilkan status di layar terkait. */
    val refId: String? = null,
)

@Entity(tableName = "cache")
data class CacheEntity(@PrimaryKey val key: String, val json: String, val updatedAt: Long)

@Entity(tableName = "notifications")
data class NotificationEntity(
    @PrimaryKey val id: Long,
    val ownerUserId: String,
    val kind: String,
    val title: String,
    val body: String?,
    val refType: String?,
    val refId: String?,
    val isUrgent: Boolean,
    val createdAt: String?,
    val read: Boolean,
)

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(item: OutboxEntity)
    @Query("SELECT * FROM outbox WHERE clientUuid = :id") suspend fun get(id: String): OutboxEntity?
    @Query("SELECT * FROM outbox WHERE ownerUserId = :owner ORDER BY createdAt DESC") fun observeAll(owner: String): Flow<List<OutboxEntity>>
    @Query("SELECT * FROM outbox WHERE ownerUserId = :owner AND status != 'SENT' ORDER BY createdAt DESC") fun observePending(owner: String): Flow<List<OutboxEntity>>
    @Query("""SELECT * FROM outbox WHERE ownerUserId = :owner AND status IN ('WAITING','SENDING') AND nextAttemptAt <= :now
              ORDER BY isUrgent DESC, createdAt ASC LIMIT :limit""")
    suspend fun due(owner: String, now: Long, limit: Int): List<OutboxEntity>
    @Query("UPDATE outbox SET status = 'WAITING' WHERE status = 'SENDING'") suspend fun resetStuck()
    @Query("UPDATE outbox SET status = 'WAITING', nextAttemptAt = 0, errorCode = NULL, errorMessage = NULL WHERE ownerUserId = :owner AND status = 'FAILED' AND errorCode = 'AUTH_EXPIRED'")
    suspend fun releaseAuthFailures(owner: String)
    @Query("DELETE FROM outbox WHERE clientUuid = :id") suspend fun delete(id: String)
    @Query("SELECT * FROM outbox WHERE status = 'SENT' AND sentAt < :before") suspend fun sentBefore(before: Long): List<OutboxEntity>
    @Query("SELECT COUNT(*) FROM outbox WHERE ownerUserId = :owner AND status != 'SENT'") fun observePendingCount(owner: String): Flow<Int>
    @Query("SELECT COUNT(*) FROM outbox WHERE ownerUserId = :owner AND status = 'FAILED'") fun observeFailedCount(owner: String): Flow<Int>
    @Query("SELECT * FROM outbox WHERE status != 'SENT'") suspend fun allUnsent(): List<OutboxEntity>
}

@Dao
interface CacheDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(item: CacheEntity)
    @Query("SELECT * FROM cache WHERE `key` = :key") suspend fun get(key: String): CacheEntity?
    @Query("SELECT * FROM cache WHERE `key` = :key") fun observe(key: String): Flow<CacheEntity?>
    @Query("DELETE FROM cache WHERE `key` LIKE :prefix || '%'") suspend fun clearPrefix(prefix: String)
}

@Dao
interface NotificationDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE) suspend fun insertAll(items: List<NotificationEntity>)
    @Query("SELECT * FROM notifications WHERE ownerUserId = :owner ORDER BY id DESC LIMIT 200") fun observe(owner: String): Flow<List<NotificationEntity>>
    @Query("SELECT COUNT(*) FROM notifications WHERE ownerUserId = :owner AND read = 0") fun observeUnread(owner: String): Flow<Int>
    @Query("UPDATE notifications SET read = 1 WHERE ownerUserId = :owner") suspend fun markAllRead(owner: String)
    @Query("UPDATE notifications SET read = 1 WHERE id = :id") suspend fun markRead(id: Long)
}

@Database(entities = [OutboxEntity::class, CacheEntity::class, NotificationEntity::class], version = 1, exportSchema = true)
abstract class AppDb : RoomDatabase() {
    abstract fun outbox(): OutboxDao
    abstract fun cache(): CacheDao
    abstract fun notifications(): NotificationDao

    companion object {
        @Volatile private var instance: AppDb? = null
        fun get(context: Context): AppDb = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, AppDb::class.java, "omos_safety.db")
                .build().also { instance = it }
        }
    }
}
