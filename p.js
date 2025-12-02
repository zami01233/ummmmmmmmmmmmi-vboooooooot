const axios = require('axios');
const cron = require('node-cron');
const { TwitterApi } = require('twitter-api-v2');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { ethers } = require("ethers");
const fs = require('fs');
const readline = require('readline');

class PengaturKonfigurasi {
  constructor() {
    this.akun = [];
    this.konfigTwitter = [];
    this.proxy = [];
    this.muatSemuaKonfig();
  }

  muatSemuaKonfig() {
    this.muatAkun();
    this.muatKonfigTwitter();
    this.muatProxy();
  }

  muatAkun() {
    try {
      if (fs.existsSync('akun.txt')) {
        const data = fs.readFileSync('akun.txt', 'utf8');
        const lines = data.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        
        this.akun = lines.map((line, index) => {
          const parts = line.split('|').map(field => field.trim());
          const [nama, wallet, cookie, privateKey, jumlahFaucet] = parts;
          
          let jumlah = 2;
          if (jumlahFaucet && !isNaN(parseInt(jumlahFaucet))) {
            jumlah = parseInt(jumlahFaucet);
          }
          
          return {
            id: index + 1,
            nama: nama || `Akun ${index + 1}`,
            wallet,
            cookie,
            privateKey: privateKey || '',
            jumlahFaucet: jumlah,
            terpilih: false
          };
        });
        console.log(`? Memuat ${this.akun.length} akun dari akun.txt`);
      } else {
        console.log('? File akun.txt tidak ditemukan');
      }
    } catch (error) {
      console.log('? Gagal memuat akun:', error.message);
    }
  }

  muatKonfigTwitter() {
    try {
      if (fs.existsSync('x.txt')) {
        const data = fs.readFileSync('x.txt', 'utf8');
        const lines = data.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        
        this.konfigTwitter = lines.map((line, index) => {
          const [appKey, appSecret, accessToken, accessSecret, nama = `Twitter ${index + 1}`] = line.split('|').map(field => field.trim());
          return {
            id: index + 1,
            nama,
            appKey,
            appSecret,
            accessToken,
            accessSecret
          };
        });
        console.log(`? Memuat ${this.konfigTwitter.length} konfigurasi Twitter dari x.txt`);
      } else {
        console.log('? File x.txt tidak ditemukan');
      }
    } catch (error) {
      console.log('? Gagal memuat konfigurasi Twitter:', error.message);
    }
  }

  muatProxy() {
    try {
      if (fs.existsSync('proxy.txt')) {
        const data = fs.readFileSync('proxy.txt', 'utf8');
        this.proxy = data.split('\n')
          .filter(line => line.trim() && !line.startsWith('#'))
          .map(proxy => proxy.trim());
        console.log(`? Memuat ${this.proxy.length} proxy dari proxy.txt`);
      } else {
        console.log('? File proxy.txt tidak ditemukan');
      }
    } catch (error) {
      console.log('? Gagal memuat proxy:', error.message);
    }
  }

  dapatkanProxyAcak() {
    if (this.proxy.length === 0) return null;
    const proxyAcak = this.proxy[Math.floor(Math.random() * this.proxy.length)];
    return new HttpsProxyAgent(proxyAcak);
  }

  dapatkanKonfigTwitter(idAkun = 1) {
    const konfig = this.konfigTwitter[idAkun - 1] || this.konfigTwitter[0];
    return konfig || null;
  }
}

class PenanganTwitter {
  constructor(pengaturKonfig) {
    this.pengaturKonfig = pengaturKonfig;
    this.indeksTwitterSekarang = 0;
  }

  dapatkanKonfigTwitterBerikutnya() {
    if (this.pengaturKonfig.konfigTwitter.length === 0) {
      return null;
    }
    const konfig = this.pengaturKonfig.konfigTwitter[this.indeksTwitterSekarang];
    this.indeksTwitterSekarang = (this.indeksTwitterSekarang + 1) % this.pengaturKonfig.konfigTwitter.length;
    return konfig;
  }

  async kirimTweet(teks, idAkun = 1, maxRetries = 3) {
    const konfig = this.dapatkanKonfigTwitterBerikutnya();
    if (!konfig) {
      console.log('   ? Tidak ada konfigurasi Twitter tersedia');
      return { sukses: false, error: 'tidak_ada_konfig_twitter' };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`   ?? Mencoba tweet (percobaan ${attempt}/${maxRetries})...`);
        
        const klien = new TwitterApi({
          appKey: konfig.appKey,
          appSecret: konfig.appSecret,
          accessToken: konfig.accessToken,
          accessSecret: konfig.accessSecret,
        });

        const klienRW = klien.readWrite;
        const response = await klienRW.v2.tweet(teks);
        const id = response?.data?.id;
        
        console.log(`   ? Tweet terkirim via ${konfig.nama}!`);
        console.log(`   ?? Link: https://x.com/i/web/status/${id}`);
        return { sukses: true, id, teks, konfig: konfig.nama };
        
      } catch (error) {
        const statusCode = error.code || error.response?.status;
        
        if (statusCode === 429 || statusCode === 403) {
          const waitTime = Math.min(attempt * 30000, 300000);
          console.log(`   ? Error ${statusCode}, tunggu ${waitTime/1000} detik...`);
          await this.tunggu(waitTime);
          continue;
        }
        
        console.log(`   ? Gagal mengirim tweet (${konfig.nama}): ${error.message}`);
        
        if (attempt < maxRetries) {
          const waitTime = attempt * 15000;
          console.log(`   ? Tunggu ${waitTime/1000} detik sebelum mencoba lagi...`);
          await this.tunggu(waitTime);
        } else {
          return { sukses: false, error: error.message };
        }
      }
    }
    
    return { sukses: false, error: 'max_retries_exceeded' };
  }

  async hapusTweet(idTweet, idAkun = 1, maxRetries = 5) {
    const konfig = this.dapatkanKonfigTwitterBerikutnya();
    if (!konfig) {
      console.log('   ? Tidak ada konfigurasi Twitter untuk penghapusan');
      return { sukses: false, error: 'tidak_ada_konfig_twitter' };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const klien = new TwitterApi({
          appKey: konfig.appKey,
          appSecret: konfig.appSecret,
          accessToken: konfig.accessToken,
          accessSecret: konfig.accessSecret,
        });

        const klienRW = klien.readWrite;
        await klienRW.v2.deleteTweet(idTweet);
        console.log(`   ??? Tweet berhasil dihapus (ID: ${idTweet}) oleh ${konfig.nama}`);
        return { sukses: true };
      } catch (error) {
        const statusCode = error.code || error.response?.status;
        
        if (statusCode === 429 || statusCode === 403) {
          const waitTime = Math.min(attempt * 30000, 300000);
          console.log(`   ? Error ${statusCode}, tunggu ${waitTime/1000} detik...`);
          await this.tunggu(waitTime);
          continue;
        }
        
        console.log(`   ? Gagal menghapus tweet: ${error.message}`);
        
        if (attempt < maxRetries) {
          await this.tunggu(15000);
        } else {
          return { sukses: false, error: error.message };
        }
      }
    }
    
    return { sukses: false, error: 'max_retries_exceeded' };
  }

  buatTweetRandomDenganUMI() {
    const kataAcak = [
      "hello", "hey", "hi", "what's up", "greetings", "howdy",
      "amazing", "awesome", "fantastic", "great", "wonderful",
      "community", "ecosystem", "project", "platform", "network",
      "crypto", "blockchain", "web3", "defi", "nft",
      "future", "innovation", "technology", "digital", "revolution",
      "excited", "happy", "thrilled", "pumped", "enthusiastic",
      "building", "creating", "developing", "growing", "expanding",
      "opportunity", "potential", "vision", "mission", "journey",
      "together", "collaboration", "partnership", "alliance", "support"
    ];

    const kalimatPembuka = [
      "Hello everyone, have you heard about Umi?",
      "Hey crypto friends, check out Umi!",
      "What's up everyone, Umi is amazing!",
      "Greetings to all Umi enthusiasts!",
      "Hi there, Umi is the future of web3!",
      "Hello community, Umi is revolutionizing crypto!",
      "Hey everyone, Umi is building something special!",
      "What's good everyone, Umi ecosystem is growing!"
    ];

    // Pilih kalimat pembuka acak
    let tweet = kalimatPembuka[Math.floor(Math.random() * kalimatPembuka.length)];
    
    // Tambah kata acak hingga mencapai minimal 30 kata
    const kataTambahan = Math.max(0, 30 - tweet.split(' ').length);
    
    for (let i = 0; i < kataTambahan; i++) {
      tweet += ' ' + kataAcak[Math.floor(Math.random() * kataAcak.length)];
    }

    // Pastikan mengandung kata "UMI" atau "Umi"
    if (!tweet.toLowerCase().includes('umi')) {
      tweet += ' Umi';
    }

    return tweet;
  }

  tunggu(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class PenanganBridge {
  constructor() {
    this.RPC = "https://ethereum.uminetwork.com";
    this.CHAIN_ID = 1337;
    this.TUJUAN_ADDRESS = "0xc8088d0362bb4ac757ca77e211c30503d39cef48";
    this.BATAS_GAS = 976872n;
    this.MAX_FEE_PER_GAS = 3000000010n;
    this.MAX_PRIORITY_FEE_PER_GAS = 3000000000n;
    this.JUMLAH_BRIDGE = ethers.parseEther("1.0");
  }

  async bridgeETH(akun, maxRetries = 5) {
    if (!akun.privateKey) {
      console.log(`   ?? [Bridge] Tidak ada private key untuk ${akun.nama}`);
      return { sukses: false, error: 'tidak_ada_private_key' };
    }

    for (let percobaanSekarang = 1; percobaanSekarang <= maxRetries; percobaanSekarang++) {
      try {
        console.log(`   ?? [Bridge] Membridge 1 ETH... (percobaan ${percobaanSekarang}/${maxRetries})`);
        
        const provider = new ethers.JsonRpcProvider(this.RPC, this.CHAIN_ID);
        const wallet = new ethers.Wallet(akun.privateKey, provider);

        const saldo = await provider.getBalance(wallet.address);
        console.log(`   ?? Saldo: ${ethers.formatEther(saldo)} ETH`);

        const biayaGasMaks = this.BATAS_GAS * this.MAX_FEE_PER_GAS;
        const saldoMinimum = this.JUMLAH_BRIDGE + biayaGasMaks;

        if (saldo < saldoMinimum) {
          console.log(`   ? [Bridge] Saldo tidak cukup untuk bridge 1 ETH + gas fee`);
          console.log(`   ?? Diperlukan: ${ethers.formatEther(saldoMinimum)} ETH`);
          console.log(`   ?? Tersedia: ${ethers.formatEther(saldo)} ETH`);
          return { sukses: false, error: 'saldo_tidak_cukup' };
        }

        const nonce = await provider.getTransactionCount(wallet.address, "pending");
        
        const tx = {
          to: this.TUJUAN_ADDRESS,
          value: this.JUMLAH_BRIDGE,
          gasLimit: this.BATAS_GAS,
          nonce,
          chainId: this.CHAIN_ID,
          type: 2,
          maxFeePerGas: this.MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: this.MAX_PRIORITY_FEE_PER_GAS,
        };

        console.log(`   ?? Mengirim transaksi bridge 1 ETH...`);
        const txTerkirim = await wallet.sendTransaction(tx);
        console.log(`   ? TX Bridge Terkirim!`);
        console.log(`   ?? Hash: ${txTerkirim.hash}`);

        console.log(`   ? Menunggu konfirmasi...`);
        const receipt = await txTerkirim.wait(1);

        if (receipt.status === 1) {
          const gasDigunakan = receipt.gasUsed;
          const hargaGasEfektif = receipt.gasPrice || receipt.effectiveGasPrice;
          const biayaGas = gasDigunakan * hargaGasEfektif;

          console.log(`   ?????? BRIDGE 1 ETH BERHASIL! ??????`);
          console.log(`      ?? Block: ${receipt.blockNumber}`);
          console.log(`      ? Gas Digunakan: ${gasDigunakan.toString()}`);
          console.log(`      ?? Biaya Gas: ${ethers.formatEther(biayaGas)} ETH`);
          console.log(`      ?? Total Bridged: 1.0 ETH`);
          return { 
            sukses: true, 
            data: receipt,
            jumlahBridge: this.JUMLAH_BRIDGE,
            biayaGas: biayaGas
          };
        }

      } catch (error) {
        if (error.code === "INSUFFICIENT_FUNDS") {
          console.log(`   ? [Bridge] Saldo tidak cukup untuk bridge 1 ETH`);
          return { sukses: false, error: 'saldo_tidak_cukup' };
        } else if (error.message.includes("nonce")) {
          console.log(`   ?? [Bridge] Error nonce, mencoba lagi...`);
          if (percobaanSekarang < maxRetries) {
            await this.tunggu(5000);
            continue;
          }
        } else {
          console.log(`   ? [Bridge] Error: ${error.message}`);
        }
        
        if (percobaanSekarang < maxRetries) {
          const waitTime = percobaanSekarang * 10000;
          console.log(`   ? Tunggu ${waitTime/1000} detik sebelum mencoba lagi...`);
          await this.tunggu(waitTime);
        }
      }
    }
    
    return { sukses: false, error: 'max_retries_exceeded' };
  }

  tunggu(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class BotUmiOdyssey {
  constructor() {
    this.pengaturKonfig = new PengaturKonfigurasi();
    this.akun = this.pengaturKonfig.akun;
    this.akunTerpilih = [];
    this.penanganTwitter = new PenanganTwitter(this.pengaturKonfig);
    this.penanganBridge = new PenanganBridge();
    this.agenProxy = this.pengaturKonfig.dapatkanProxyAcak();
    this.loopAktif = false;
    this.statusTask = {};
    this.tanggalReset = this.dapatkanTanggalHariIni();
    
    // ENDPOINT YANG DIPERBAIKI
    this.urlFaucet = 'https://faucet.uminetwork.com/api/fundUser';
    this.urlXP = 'https://odyssey.page/api/player/daily-xp';
    this.urlQuestFaucet = 'https://odyssey.page/api/quest/check-faucet';
    this.urlQuestTweet = 'https://odyssey.page/api/quest/check-tweet';
    
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    ];
    
    if (this.akun.length === 0) {
      console.error('? Tidak ada akun ditemukan! Silakan setup di file akun.txt');
      process.exit(1);
    }
  }

  dapatkanUserAgentAcak() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  // HEADER YANG DIPERBAIKI untuk odyssey.page
  dapatkanHeaderOdyssey(cookie) {
    return {
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'User-Agent': this.dapatkanUserAgentAcak(),
      'Origin': 'https://odyssey.page',
      'Referer': 'https://odyssey.page/quests',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Priority': 'u=1, i'
    };
  }

  dapatkanHeaderFaucet(cookie) {
    return {
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'User-Agent': this.dapatkanUserAgentAcak()
    };
  }

  dapatkanInstanceAxios() {
    const konfig = {
      timeout: 60000,
      httpsAgent: this.agenProxy
    };
    return axios.create(konfig);
  }

  tunggu(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async tungguDenganCountdown(ms, pesan = "Menunggu") {
    const totalDetik = Math.floor(ms / 1000);
    let sisaDetik = totalDetik;

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const jam = Math.floor(sisaDetik / 3600);
        const menit = Math.floor((sisaDetik % 3600) / 60);
        const detik = sisaDetik % 60;

        const formatWaktu = `${jam.toString().padStart(2, '0')}:${menit.toString().padStart(2, '0')}:${detik.toString().padStart(2, '0')}`;
        
        process.stdout.write(`\r? ${pesan}: ${formatWaktu} `);

        sisaDetik--;

        if (sisaDetik < 0) {
          clearInterval(interval);
          process.stdout.write('\r' + ' '.repeat(100) + '\r');
          resolve();
        }
      }, 1000);
    });
  }

  dapatkanWaktuSekarang() {
    return new Date().toLocaleString('id-ID', { 
      timeZone: 'Asia/Jakarta',
      dateStyle: 'full',
      timeStyle: 'long'
    });
  }

  dapatkanTanggalHariIni() {
    return new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  }

  cekDanResetStatusHarian() {
    const tanggalSekarang = this.dapatkanTanggalHariIni();
    if (this.tanggalReset !== tanggalSekarang) {
      console.log(`\n?? Hari baru terdeteksi! Reset status semua task...`);
      console.log(`?? Tanggal lama: ${this.tanggalReset}`);
      console.log(`?? Tanggal baru: ${tanggalSekarang}`);
      this.statusTask = {};
      this.tanggalReset = tanggalSekarang;
      console.log(`? Status task berhasil direset!\n`);
    }
  }

  initStatusTask(idAkun) {
    if (!this.statusTask[idAkun]) {
      this.statusTask[idAkun] = {
        faucet: false,
        questFaucet: false,
        xpHarian: false,
        questTweet: false,
        bridge: false
      };
    }
  }

  tandaiTaskSelesai(idAkun, namaTask) {
    this.initStatusTask(idAkun);
    this.statusTask[idAkun][namaTask] = true;
  }

  cekTaskSudahSelesai(idAkun, namaTask) {
    this.initStatusTask(idAkun);
    return this.statusTask[idAkun][namaTask] === true;
  }

  tampilkanStatusTask(akun) {
    this.initStatusTask(akun.id);
    const status = this.statusTask[akun.id];
    console.log(`\n   ?? Status Task ${akun.nama}:`);
    console.log(`      ${status.faucet ? '?' : '?'} Faucet`);
    console.log(`      ${status.questFaucet ? '?' : '?'} Quest Faucet`);
    console.log(`      ${status.xpHarian ? '?' : '?'} XP Harian & Check-in`);
    console.log(`      ${status.questTweet ? '?' : '?'} Quest Tweet UMI`);
    console.log(`      ${status.bridge ? '?' : '?'} Bridge ETH\n`);
  }

  async pilihAkun() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('\n?? Daftar Akun:');
    this.akun.forEach((akun, indeks) => {
      const statusBridge = akun.privateKey ? '??' : '?';
      console.log(`   ${indeks + 1}. ${akun.nama} - ${akun.wallet.substring(0, 10)}...${akun.wallet.slice(-8)} ${statusBridge} (Faucet: ${akun.jumlahFaucet} UMI)`);
    });

    const tanya = (query) => new Promise(resolve => rl.question(query, resolve));

    try {
      const input = await tanya('\n?? Pilih akun (nomor, dipisahkan koma, atau "all" untuk semua): ');
      
      if (input.toLowerCase() === 'all') {
        this.akunTerpilih = [...this.akun];
        console.log('? Memilih semua akun');
      } else {
        const nomorTerpilih = input.split(',').map(num => parseInt(num.trim()) - 1);
        this.akunTerpilih = this.akun.filter((_, indeks) => nomorTerpilih.includes(indeks));
        
        if (this.akunTerpilih.length === 0) {
          console.log('?? Tidak ada akun dipilih, gunakan semua akun');
          this.akunTerpilih = [...this.akun];
        } else {
          console.log(`? Memilih ${this.akunTerpilih.length} akun`);
        }
      }
      
      this.akun.forEach(akun => {
        akun.terpilih = this.akunTerpilih.some(terpilih => terpilih.id === akun.id);
      });

    } finally {
      rl.close();
    }
  }

  async klaimFaucet(akun, maxRetries = 2) {
    if (this.cekTaskSudahSelesai(akun.id, 'faucet')) {
      console.log(`   ?? [1/5] Faucet sudah diklaim hari ini, skip...`);
      return { sukses: true, skipped: true };
    }

    const instanceAxios = this.dapatkanInstanceAxios();
    
    for (let percobaanSekarang = 1; percobaanSekarang <= maxRetries; percobaanSekarang++) {
      try {
        console.log(`   ?? [1/5] Mengklaim ${akun.jumlahFaucet} UMI... (percobaan ${percobaanSekarang}/${maxRetries})`);
        
        if (percobaanSekarang > 1) {
          await this.tungguDenganCountdown(60000, "Delay sebelum retry klaim faucet");
        }
        
        const payload = {
          walletAddress: akun.wallet,
          amount: akun.jumlahFaucet
        };

        const response = await instanceAxios.post(this.urlFaucet, payload, {
          headers: this.dapatkanHeaderFaucet(akun.cookie)
        });

        if (response.status === 200) {
          console.log(`   ? [1/5] Berhasil klaim ${akun.jumlahFaucet} UMI!`);
          if (response.data) {
            console.log(`   ?? Data: ${JSON.stringify(response.data)}`);
          }
          this.tandaiTaskSelesai(akun.id, 'faucet');
          return { sukses: true, data: response.data };
        }

      } catch (error) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.error || error.message;
        
        console.log(`   ? [1/5] Status Code: ${statusCode || 'N/A'}`);
        console.log(`   ? [1/5] Error Message: ${errorMessage}`);
        
        if (statusCode === 429) {
          console.log(`   ? [1/5] Rate limit! Menunggu 2 menit...`);
          if (percobaanSekarang < maxRetries) {
            await this.tungguDenganCountdown(120000, "Menunggu rate limit selesai");
            continue;
          }
        } else if (statusCode === 400) {
          if (errorMessage && errorMessage.toLowerCase().includes('sudah')) {
            console.log(`   ?? [1/5] Sudah diklaim hari ini`);
            this.tandaiTaskSelesai(akun.id, 'faucet');
            return { sukses: false, error: 'sudah_diklaim' };
          }
          console.log(`   ? [1/5] Bad Request: ${errorMessage}`);
          return { sukses: false, error: errorMessage };
        } else if (statusCode === 401 || statusCode === 403) {
          console.log(`   ? [1/5] Cookie tidak valid atau expired!`);
          return { sukses: false, error: 'cookie_invalid' };
        }
      }
    }
    
    console.log(`   ? [1/5] Gagal setelah ${maxRetries} percobaan, lanjut ke task berikutnya`);
    return { sukses: false, error: 'max_retries_exceeded' };
  }

  async klaimQuestFaucet(akun, maxRetries = 2) {
    if (this.cekTaskSudahSelesai(akun.id, 'questFaucet')) {
      console.log(`   ?? [2/5] Quest Faucet sudah diklaim hari ini, skip...`);
      return { sukses: true, skipped: true };
    }

    const instanceAxios = this.dapatkanInstanceAxios();
    
    for (let percobaanSekarang = 1; percobaanSekarang <= maxRetries; percobaanSekarang++) {
      try {
        console.log(`   ?? [2/5] Mengklaim Quest Faucet... (percobaan ${percobaanSekarang}/${maxRetries})`);
        
        if (percobaanSekarang > 1) {
          await this.tungguDenganCountdown(60000, "Delay sebelum retry quest faucet");
        }
        
        const payload = {
          questId: 10,
          walletAddress: akun.wallet
        };

        const response = await instanceAxios.post(this.urlQuestFaucet, payload, {
          headers: this.dapatkanHeaderOdyssey(akun.cookie)
        });

        if (response.status === 200) {
          console.log(`   ? [2/5] Quest Faucet berhasil diklaim!`);
          if (response.data) {
            console.log(`   ?? Data: ${JSON.stringify(response.data)}`);
          }
          this.tandaiTaskSelesai(akun.id, 'questFaucet');
          return { sukses: true, data: response.data };
        }

      } catch (error) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.error || error.message;
        
        console.log(`   ? [2/5] Status Code: ${statusCode || 'N/A'}`);
        console.log(`   ? [2/5] Error Message: ${errorMessage}`);
        
        if (statusCode === 429) {
          console.log(`   ? [2/5] Rate limit! Menunggu 2 menit...`);
          if (percobaanSekarang < maxRetries) {
            await this.tungguDenganCountdown(120000, "Menunggu rate limit selesai");
            continue;
          }
        } else if (statusCode === 400) {
          if (errorMessage && (errorMessage.toLowerCase().includes('sudah') || errorMessage.toLowerCase().includes('completed'))) {
            console.log(`   ?? [2/5] Quest sudah selesai`);
            this.tandaiTaskSelesai(akun.id, 'questFaucet');
            return { sukses: false, error: 'quest_selesai' };
          }
          console.log(`   ? [2/5] Bad Request: ${errorMessage}`);
          return { sukses: false, error: errorMessage };
        } else if (statusCode === 401 || statusCode === 403) {
          console.log(`   ? [2/5] Cookie tidak valid atau expired!`);
          return { sukses: false, error: 'cookie_invalid' };
        }
      }
    }
    
    console.log(`   ? [2/5] Gagal setelah ${maxRetries} percobaan, lanjut ke task berikutnya`);
    return { sukses: false, error: 'max_retries_exceeded' };
  }

  async klaimXPHarian(akun, maxRetries = 5) {
    if (this.cekTaskSudahSelesai(akun.id, 'xpHarian')) {
      console.log(`   ?? [3/5] XP Harian sudah diklaim hari ini, skip...`);
      return { sukses: true, skipped: true };
    }

    const instanceAxios = this.dapatkanInstanceAxios();
    
    for (let percobaanSekarang = 1; percobaanSekarang <= maxRetries; percobaanSekarang++) {
      try {
        console.log(`   ?? [3/5] Mengklaim XP Harian dan Check-in... (percobaan ${percobaanSekarang}/${maxRetries})`);
        
        // Coba dengan payload yang berbeda
        const payloads = [
          { walletAddress: akun.wallet, timeZone: "Asia/Jakarta" },
          { walletAddress: akun.wallet },
          { walletAddress: akun.wallet, timezone: "Asia/Jakarta" }
        ];

        let berhasil = false;
        
        for (const payload of payloads) {
          try {
            console.log(`   ?? Mencoba payload: ${JSON.stringify(payload)}`);
            
            const response = await instanceAxios.post(this.urlXP, payload, {
              headers: this.dapatkanHeaderOdyssey(akun.cookie)
            });

            if (response.status === 200) {
              console.log(`   ? [3/5] Berhasil klaim XP dan Check-in!`);
              console.log(`   ?? Response: ${JSON.stringify(response.data)}`);
              this.tandaiTaskSelesai(akun.id, 'xpHarian');
              berhasil = true;
              break;
            }
          } catch (innerError) {
            // Lanjut ke payload berikutnya jika gagal
            continue;
          }
        }

        if (berhasil) {
          return { sukses: true };
        }

        // Jika semua payload gagal, lempar error
        throw new Error('Semua payload gagal');

      } catch (error) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.error || error.message;
        
        console.log(`   ? [3/5] Status Code: ${statusCode || 'N/A'}`);
        console.log(`   ? [3/5] Error Message: ${errorMessage}`);
        
        if (errorData) {
          console.log(`   ?? [3/5] Full Error Data: ${JSON.stringify(errorData)}`);
        }
        
        if (statusCode === 429) {
          console.log(`   ? [3/5] Rate limit! Menunggu 2 menit...`);
          if (percobaanSekarang < maxRetries) {
            await this.tungguDenganCountdown(120000, "Menunggu rate limit selesai");
            continue;
          }
        } else if (statusCode === 400) {
          if (errorMessage && errorMessage.toLowerCase().includes('sudah')) {
            console.log(`   ?? [3/5] Sudah diklaim hari ini`);
            this.tandaiTaskSelesai(akun.id, 'xpHarian');
            return { sukses: false, error: 'sudah_diklaim' };
          }
          console.log(`   ? [3/5] Bad Request - coba payload lain`);
        } else if (statusCode === 401 || statusCode === 403) {
          console.log(`   ? [3/5] Cookie tidak valid atau expired!`);
          console.log(`   ?? [3/5] Silakan update cookie untuk akun: ${akun.nama}`);
          return { sukses: false, error: 'cookie_invalid' };
        } else if (statusCode === 404) {
          console.log(`   ? [3/5] Endpoint tidak ditemukan - API mungkin berubah`);
          return { sukses: false, error: 'endpoint_not_found' };
        } else if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
          console.log(`   ?? [3/5] Server error - coba lagi`);
          if (percobaanSekarang < maxRetries) {
            await this.tungguDenganCountdown(60000, "Menunggu server recovery");
            continue;
          }
        }
        
        // Tunggu sebelum retry
        if (percobaanSekarang < maxRetries) {
          const waitTime = percobaanSekarang * 30000;
          console.log(`   ? Tunggu ${waitTime/1000} detik sebelum mencoba lagi...`);
          await this.tunggu(waitTime);
        }
      }
    }
    
    console.log(`   ? [3/5] Gagal setelah ${maxRetries} percobaan, lanjut ke task berikutnya`);
    return { sukses: false, error: 'max_retries_exceeded' };
  }

  async prosesQuestTweetUMI(akun, maxRetries = 3) {
    if (this.cekTaskSudahSelesai(akun.id, 'questTweet')) {
      console.log(`   ?? [4/5] Quest Tweet sudah diklaim hari ini, skip...`);
      return { sukses: true, skipped: true };
    }

    const instanceAxios = this.dapatkanInstanceAxios();
    
    console.log(`   ?? [4/5] Memposting tweet untuk UMI...`);
    
    // Generate tweet random dengan minimal 30 kata mengandung "UMI"
    const tweet = this.penanganTwitter.buatTweetRandomDenganUMI();
    console.log(`   ?? Tweet: "${tweet}"`);
    console.log(`   ?? Jumlah kata: ${tweet.split(' ').length}`);

    const hasilTweet = await this.penanganTwitter.kirimTweet(tweet, akun.id, 2);
    
    if (!hasilTweet.sukses) {
      console.log(`   ? [4/5] Gagal posting tweet, lewati quest ini`);
      return { sukses: false, error: 'tweet_gagal' };
    }

    console.log(`   ? Menunggu 45 detik sebelum klaim quest...`);
    await this.tungguDenganCountdown(45000, "Menunggu sebelum klaim quest tweet");

    for (let percobaanSekarang = 1; percobaanSekarang <= maxRetries; percobaanSekarang++) {
      try {
        console.log(`   ?? [4/5] Mengklaim quest tweet UMI... (percobaan ${percobaanSekarang}/${maxRetries})`);
        
        if (percobaanSekarang > 1) {
          await this.tungguDenganCountdown(30000, "Delay sebelum retry quest UMI");
        }
        
        // PAYLOAD QUEST TWEET UMI YANG BARU
        const payloadUmi = {
          questId: 9,
          walletAddress: akun.wallet
        };

        console.log(`   ?? Payload: ${JSON.stringify(payloadUmi)}`);

        const responseUmi = await instanceAxios.post(this.urlQuestTweet, payloadUmi, {
          headers: this.dapatkanHeaderOdyssey(akun.cookie)
        });

        if (responseUmi.status === 200) {
          console.log(`   ? [4/5] Quest UMI berhasil diklaim!`);
          console.log(`   ?? Response: ${JSON.stringify(responseUmi.data)}`);
          
          await this.tunggu(5000);
          console.log(`   ??? [4/5] Menghapus tweet...`);
          await this.penanganTwitter.hapusTweet(hasilTweet.id, akun.id, 2);
          
          this.tandaiTaskSelesai(akun.id, 'questTweet');
          return { sukses: true, data: responseUmi.data, idTweet: hasilTweet.id };
        }

      } catch (error) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.error || error.message;
        
        console.log(`   ? [4/5] Status Code: ${statusCode || 'N/A'}`);
        console.log(`   ? [4/5] Error Message: ${errorMessage}`);
        
        if (statusCode === 429) {
          console.log(`   ? [4/5] Rate limit! Menunggu 2 menit...`);
          if (percobaanSekarang < maxRetries) {
            await this.tungguDenganCountdown(120000, "Menunggu rate limit selesai");
            continue;
          }
        } else if (statusCode === 400) {
          if (errorMessage && errorMessage.toLowerCase().includes('sudah') || errorMessage.toLowerCase().includes('completed')) {
            console.log(`   ?? [4/5] Quest UMI sudah selesai`);
            
            await this.tunggu(3000);
            console.log(`   ??? [4/5] Menghapus tweet...`);
            await this.penanganTwitter.hapusTweet(hasilTweet.id, akun.id, 2);
            
            this.tandaiTaskSelesai(akun.id, 'questTweet');
            return { sukses: true, data: { umi: true }, idTweet: hasilTweet.id };
          }
          console.log(`   ? [4/5] Bad Request: ${errorMessage}`);
        } else if (statusCode === 401 || statusCode === 403) {
          console.log(`   ? [4/5] Cookie tidak valid atau expired!`);
          break;
        } else {
          console.log(`   ? [4/5] Error: ${error.message}`);
        }
        
        if (percobaanSekarang < maxRetries) {
          await this.tunggu(15000);
        }
      }
    }

    console.log(`   ??? [4/5] Menghapus tweet...`);
    await this.penanganTwitter.hapusTweet(hasilTweet.id, akun.id, 2);
    
    console.log(`   ? [4/5] Gagal setelah ${maxRetries} percobaan, lanjut ke task berikutnya`);
    return { sukses: false, error: 'quest_gagal' };
  }

  async jalankanKlaimXPHarianSaja() {
    console.log('\n?? === KLAIM XP HARIAN & CHECK-IN SAJA ===\n');
    
    for (const akun of this.akunTerpilih) {
      console.log(`\n?? Memproses: ${akun.nama}`);
      console.log(`?? Wallet: ${akun.wallet.substring(0, 10)}...${akun.wallet.slice(-8)}`);
      
      const hasil = await this.klaimXPHarian(akun, 5); // 5x retry untuk XP harian
      
      if (hasil.sukses) {
        console.log(`   ? Berhasil claim XP harian untuk ${akun.nama}!`);
      } else {
        console.log(`   ? Gagal claim XP harian untuk ${akun.nama}`);
      }
      
      // Jeda antar akun
      if (this.akunTerpilih.indexOf(akun) < this.akunTerpilih.length - 1) {
        console.log(`\n? Jeda 30 detik sebelum akun berikutnya...`);
        await this.tungguDenganCountdown(30000, "Jeda antar akun");
      }
    }
    
    console.log('\n? Semua akun selesai klaim XP harian dan check-in!');
  }

  async tampilkanMenu() {
    console.log('\n' + '='.repeat(60));
    console.log('?? BOT OTOMATIS UMI NETWORK & ODYSSEY');
    console.log('='.repeat(60));
    console.log('Pilih fitur yang ingin dijalankan:');
    console.log('1. ?? Klaim XP Harian & Check-in Saja (FIXED)');
    console.log('2. ?? Klaim Faucet Saja');
    console.log('3. ?? Bridge 1 ETH Saja');
    console.log('4. ?? Klaim Quest Faucet');
    console.log('5. ?? Klaim Quest Post X (UMI)');
    console.log('6. ?? Mode Otomatis (Jalankan Semua - Sekali)');
    console.log('7. ?? Mode Otomatis Loop 24 Jam (Jalankan Terus)');
    console.log('8. ?? Muat Ulang Konfigurasi');
    console.log('0. ? Keluar');
    console.log('='.repeat(60));
  }

  async main() {
    console.log('?? Bot Otomatis UMI Network & Odyssey');
    console.log('==========================================');
    console.log(`?? Memuat ${this.akun.length} akun`);
    
    if (this.pengaturKonfig.konfigTwitter.length > 0) {
      console.log(`?? Memuat ${this.pengaturKonfig.konfigTwitter.length} konfigurasi Twitter`);
    } else {
      console.log('? Tidak ada konfigurasi Twitter');
    }
    
    if (this.pengaturKonfig.proxy.length > 0) {
      console.log(`?? Memuat ${this.pengaturKonfig.proxy.length} proxy`);
    } else {
      console.log('? Tidak ada proxy');
    }

    while (true) {
      await this.tampilkanMenu();
      
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const tanya = (query) => new Promise(resolve => rl.question(query, resolve));

      try {
        const pilihan = await tanya('\n?? Masukkan pilihan (0-8): ');
        
        if (pilihan !== '8' && pilihan !== '0') {
          await this.pilihAkun();
        }

        switch (pilihan) {
          case '1':
            await this.jalankanKlaimXPHarianSaja();
            break;
          case '2':
            await this.jalankanKlaimFaucetSaja();
            break;
          case '3':
            await this.jalankanBridgeSaja();
            break;
          case '4':
            await this.jalankanKlaimQuestFaucet();
            break;
          case '5':
            await this.jalankanKlaimQuestTweet();
            break;
          case '6':
            await this.jalankanModeOtomatis();
            break;
          case '7':
            rl.close();
            await this.jalankanModeOtomatisLoop();
            return;
          case '8':
            this.pengaturKonfig.muatSemuaKonfig();
            this.akun = this.pengaturKonfig.akun;
            console.log('? Konfigurasi berhasil dimuat ulang!');
            break;
          case '0':
            console.log('?? Sampai jumpa!');
            rl.close();
            return;
          default:
            console.log('? Pilihan tidak valid!');
        }

        if (pilihan !== '7') {
          const lanjut = await tanya('\n?? Kembali ke menu utama? (y/n): ');
          if (lanjut.toLowerCase() !== 'y') {
            console.log('?? Sampai jumpa!');
            rl.close();
            return;
          }
        }

      } finally {
        if (!rl.closed) {
          rl.close();
        }
      }
    }
  }

  async jalankanKlaimFaucetSaja() {
    console.log('\n?? === KLAIM FAUCET SAJA ===\n');
    for (const akun of this.akunTerpilih) {
      console.log(`\n?? Memproses: ${akun.nama}`);
      await this.klaimFaucet(akun);
      await this.tunggu(30000);
    }
    console.log('\n? Semua akun selesai klaim faucet!');
  }

  async jalankanBridgeSaja() {
    console.log('\n?? === BRIDGE 1 ETH SAJA ===\n');
    for (const akun of this.akunTerpilih) {
      console.log(`\n?? Memproses: ${akun.nama}`);
      if (!akun.privateKey) {
        console.log(`   ?? Tidak ada private key, lewati bridge`);
        continue;
      }
      await this.penanganBridge.bridgeETH(akun);
      await this.tunggu(30000);
    }
    console.log('\n? Semua akun selesai bridge!');
  }

  async jalankanKlaimQuestFaucet() {
    console.log('\n?? === KLAIM QUEST FAUCET ===\n');
    for (const akun of this.akunTerpilih) {
      console.log(`\n?? Memproses: ${akun.nama}`);
      await this.klaimQuestFaucet(akun);
      await this.tunggu(30000);
    }
    console.log('\n? Semua akun selesai klaim quest faucet!');
  }

  async jalankanKlaimQuestTweet() {
    console.log('\n?? === KLAIM QUEST POST X (UMI) ===\n');
    for (const akun of this.akunTerpilih) {
      console.log(`\n?? Memproses: ${akun.nama}`);
      await this.prosesQuestTweetUMI(akun);
      await this.tunggu(30000);
    }
    console.log('\n? Semua akun selesai klaim quest tweet!');
  }

  async jalankanModeOtomatis() {
    console.log('\n?? === MODE OTOMATIS - JALANKAN SEMUA TASK ===\n');
    this.cekDanResetStatusHarian();
    
    for (const akun of this.akunTerpilih) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`?? MEMPROSES: ${akun.nama}`);
      console.log(`?? Wallet: ${akun.wallet.substring(0, 10)}...${akun.wallet.slice(-8)}`);
      console.log(`${'='.repeat(60)}`);

      await this.klaimFaucet(akun);
      await this.tunggu(60000);
      
      await this.klaimQuestFaucet(akun);
      await this.tunggu(60000);
      
      await this.klaimXPHarian(akun);
      await this.tunggu(60000);
      
      await this.prosesQuestTweetUMI(akun);
      await this.tunggu(60000);

      if (akun.privateKey) {
        await this.penanganBridge.bridgeETH(akun);
      }
      
      console.log(`\n? SELESAI: ${akun.nama}`);
      
      if (this.akunTerpilih.indexOf(akun) < this.akunTerpilih.length - 1) {
        console.log(`\n? Jeda 2 menit sebelum akun berikutnya...`);
        await this.tungguDenganCountdown(120000, "Jeda antar akun");
      }
    }
    
    console.log('\n?? SEMUA TASK SELESAI DIJALANKAN!');
  }

  async jalankanModeOtomatisLoop() {
    console.log('\n?? === MODE OTOMATIS LOOP 24 JAM ===\n');
    this.loopAktif = true;
    let putaranKe = 1;

    while (this.loopAktif) {
      console.log(`\n?? PUTARAN KE-${putaranKe}`);
      console.log(`? Waktu Mulai: ${this.dapatkanWaktuSekarang()}`);
      
      await this.jalankanModeOtomatis();

      const delayMs = (24 * 60 * 60 * 1000) + (5 * 60 * 1000);
      const waktuBerikutnya = new Date(Date.now() + delayMs);
      
      console.log(`\n?? Putaran berikutnya: ${waktuBerikutnya.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
      await this.tungguDenganCountdown(delayMs, `Menunggu 24 jam 5 menit untuk putaran berikutnya`);
      
      putaranKe++;
    }
  }
}

async function mulaiBot() {
  try {
    const bot = new BotUmiOdyssey();
    await bot.main();
  } catch (error) {
    console.error('? Gagal menjalankan bot:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('\n\n?? Bot dihentikan oleh pengguna');
  process.exit(0);
});

mulaiBot();
