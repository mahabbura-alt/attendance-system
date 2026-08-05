package com.perusahaan.absensi.ui

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.perusahaan.absensi.R
import com.perusahaan.absensi.network.RetrofitClient
import com.perusahaan.absensi.network.dto.ItemHmHarian
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.text.SimpleDateFormat
import java.util.Locale

class RekapHmActivity : AppCompatActivity() {

    private lateinit var tvPeriode: TextView
    private lateinit var tvTotalHmBulanIni: TextView
    private lateinit var tvTotalHariOperasi: TextView
    private lateinit var rvHarian: RecyclerView
    private lateinit var tvKosong: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var btnBack: ImageView

    private val adapter = HmHarianAdapter()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_rekap_hm)

        btnBack = findViewById(R.id.btnBack)
        tvPeriode = findViewById(R.id.tvPeriode)
        tvTotalHmBulanIni = findViewById(R.id.tvTotalHmBulanIni)
        tvTotalHariOperasi = findViewById(R.id.tvTotalHariOperasi)
        rvHarian = findViewById(R.id.rvHarian)
        tvKosong = findViewById(R.id.tvKosong)
        progressBar = findViewById(R.id.progressBar)

        btnBack.setOnClickListener { finish() }

        rvHarian.layoutManager = LinearLayoutManager(this)
        rvHarian.adapter = adapter

        muatDataRekapHm()
    }

    private fun muatDataRekapHm() {
        progressBar.visibility = View.VISIBLE

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val response = RetrofitClient.api.getRekapHm()

                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    if (response.isSuccessful && response.body() != null) {
                        val data = response.body()!!
                        tvPeriode.text = "Periode: ${data.bulanTahun}"
                        tvTotalHmBulanIni.text = String.format(Locale.getDefault(), "%.2f Jam", data.totalHmBulanIni)
                        tvTotalHariOperasi.text = "${data.totalHariOperasi} Hari"

                        if (data.listHarian.isEmpty()) {
                            tvKosong.visibility = View.VISIBLE
                            rvHarian.visibility = View.GONE
                        } else {
                            tvKosong.visibility = View.GONE
                            rvHarian.visibility = View.VISIBLE
                            adapter.submitList(data.listHarian)
                        }
                    } else {
                        Toast.makeText(this@RekapHmActivity, "Gagal memuat rekap HM", Toast.LENGTH_SHORT).show()
                    }
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    progressBar.visibility = View.GONE
                    Toast.makeText(this@RekapHmActivity, "Error: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private class HmHarianAdapter : RecyclerView.Adapter<HmHarianAdapter.ViewHolder>() {

        private val items = mutableListOf<ItemHmHarian>()

        fun submitList(list: List<ItemHmHarian>) {
            items.clear()
            items.addAll(list)
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_hm_harian, parent, false)
            return ViewHolder(view)
        }

        override fun onBindViewHolder(holder: ViewHolder, position: Int) {
            holder.bind(items[position])
        }

        override fun getItemCount(): Int = items.size

        class ViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
            private val tvTanggal: TextView = itemView.findViewById(R.id.tvTanggal)
            private val tvKodeUnit: TextView = itemView.findViewById(R.id.tvKodeUnit)
            private val tvHmAwal: TextView = itemView.findViewById(R.id.tvHmAwal)
            private val tvHmAkhir: TextView = itemView.findViewById(R.id.tvHmAkhir)
            private val tvTotalHm: TextView = itemView.findViewById(R.id.tvTotalHm)
            private val tvKeterangan: TextView = itemView.findViewById(R.id.tvKeterangan)

            fun bind(item: ItemHmHarian) {
                tvTanggal.text = formatTanggalPretty(item.tanggal)
                tvKodeUnit.text = item.kodeUnit
                tvHmAwal.text = String.format(Locale.getDefault(), "%.2f", item.hmAwal)
                tvHmAkhir.text = String.format(Locale.getDefault(), "%.2f", item.hmAkhir)
                tvTotalHm.text = String.format(Locale.getDefault(), "%.2f Jam", item.totalHm)

                if (!item.keterangan.isNullOrBlank()) {
                    tvKeterangan.visibility = View.VISIBLE
                    tvKeterangan.text = "Keterangan: ${item.keterangan}"
                } else {
                    tvKeterangan.visibility = View.GONE
                }
            }

            private fun formatTanggalPretty(tglStr: String): String {
                return try {
                    val inputFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
                    val date = inputFormat.parse(tglStr.split("T")[0])
                    val outputFormat = SimpleDateFormat("dd MMMM yyyy", Locale("id", "ID"))
                    if (date != null) outputFormat.format(date) else tglStr
                } catch (e: Exception) {
                    tglStr
                }
            }
        }
    }
}
