package com.perusahaan.absensi.network.dto

import com.google.gson.annotations.SerializedName

data class RekapHmResponse(
    @SerializedName("periode") val periode: String,
    @SerializedName("bulan_tahun") val bulanTahun: String,
    @SerializedName("tanggal_mulai") val tanggalMulai: String,
    @SerializedName("tanggal_akhir") val tanggalAkhir: String,
    @SerializedName("total_hm_bulan_ini") val totalHmBulanIni: Double,
    @SerializedName("total_hari_operasi") val totalHariOperasi: Int,
    @SerializedName("list_harian") val listHarian: List<ItemHmHarian>
)

data class ItemHmHarian(
    @SerializedName("id") val id: String,
    @SerializedName("tanggal") val tanggal: String,
    @SerializedName("kode_unit") val kodeUnit: String,
    @SerializedName("hm_awal") val hmAwal: Double,
    @SerializedName("hm_akhir") val hmAkhir: Double,
    @SerializedName("total_hm") val totalHm: Double,
    @SerializedName("keterangan") val keterangan: String?
)
