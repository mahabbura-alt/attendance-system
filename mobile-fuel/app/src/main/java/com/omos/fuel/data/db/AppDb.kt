package com.omos.fuel.data.db

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

/** Status antrean lokal. SENT = diterima server (bisa tetap "menunggu validasi" di sisi server). */
object OutboxStatus {
    const val WAITING = "WAITING"
    const val SENDING = "SENDING"
    const val SENT = "SENT"
    const val REJECTED = "REJECTED"
}

/**
 * Satu transaksi di antrean. Foto disimpan sebagai daftar PhotoRef (JSON) dan diunggah dulu
 * (tahap 1, idempoten per client_uuid foto) sebelum item dikirim ke /sync (tahap 2).
 */
@Entity(tableName = "outbox")
data class OutboxEntity(
    @PrimaryKey val clientUuid: String,
    val ownerUserId: String,
    val type: String,
    val title: String,
    val payloadJson: String,
    val photosJson: String,
    val liter: Double,
    val sourceLocationId: String?,
    val createdAt: Long,
    val status: String = OutboxStatus.WAITING,
    val attempts: Int = 0,
    val nextAttemptAt: Long = 0,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val serverId: String? = null,
    val serverStatus: String? = null,
    val serverReason: String? = null,
    val flagsJson: String? = null,
    val sentAt: Long? = null,
)

@Entity(tableName = "cache")
data class CacheEntity(@PrimaryKey val key: String, val json: String, val updatedAt: Long)

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun upsert(item: OutboxEntity)
    @Query("SELECT * FROM outbox WHERE clientUuid = :id") suspend fun get(id: String): OutboxEntity?
    @Query("SELECT * FROM outbox WHERE ownerUserId = :owner ORDER BY createdAt DESC LIMIT 300") fun observeAll(owner: String): Flow<List<OutboxEntity>>
    @Query("SELECT * FROM outbox WHERE status IN ('WAITING','SENDING')") fun observeUnsentAll(): Flow<List<OutboxEntity>>
    @Query("""SELECT * FROM outbox WHERE ownerUserId = :owner AND status IN ('WAITING','SENDING') AND nextAttemptAt <= :now
              ORDER BY createdAt ASC LIMIT :limit""")
    suspend fun due(owner: String, now: Long, limit: Int): List<OutboxEntity>
    @Query("UPDATE outbox SET status = 'WAITING' WHERE status = 'SENDING'") suspend fun resetStuck()
    @Query("UPDATE outbox SET nextAttemptAt = 0 WHERE ownerUserId = :owner AND status = 'WAITING'") suspend fun retryNow(owner: String)
    @Query("SELECT * FROM outbox WHERE ownerUserId = :owner AND status = 'SENT' AND serverStatus IN ('pending_validation','submitted','draft') ORDER BY createdAt DESC LIMIT 100")
    suspend fun awaitingServer(owner: String): List<OutboxEntity>
    @Query("SELECT * FROM outbox WHERE status = 'SENT' AND sentAt < :before") suspend fun sentBefore(before: Long): List<OutboxEntity>
    @Query("DELETE FROM outbox WHERE clientUuid = :id") suspend fun delete(id: String)
    @Query("SELECT COUNT(*) FROM outbox WHERE ownerUserId = :owner AND status IN ('WAITING','SENDING')") fun observePendingCount(owner: String): Flow<Int>
    @Query("SELECT * FROM outbox WHERE ownerUserId = :owner AND type = :type ORDER BY createdAt DESC LIMIT 1") suspend fun latestOfType(owner: String, type: String): OutboxEntity?
    @Query("SELECT * FROM outbox WHERE type = 'fill' AND createdAt >= :since") suspend fun fillsSince(since: Long): List<OutboxEntity>
}

@Dao
interface CacheDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE) suspend fun put(item: CacheEntity)
    @Query("SELECT * FROM cache WHERE `key` = :key") suspend fun get(key: String): CacheEntity?
    @Query("SELECT * FROM cache WHERE `key` = :key") fun observe(key: String): Flow<CacheEntity?>
}

@Database(entities = [OutboxEntity::class, CacheEntity::class], version = 1, exportSchema = true)
abstract class AppDb : RoomDatabase() {
    abstract fun outbox(): OutboxDao
    abstract fun cache(): CacheDao

    companion object {
        @Volatile private var instance: AppDb? = null
        fun get(context: Context): AppDb = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(context.applicationContext, AppDb::class.java, "omos_fuel.db")
                .build().also { instance = it }
        }
    }
}
