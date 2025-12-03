const axios = require('axios');
const cron = require('node-cron');
const { TwitterApi } = require('twitter-api-v2');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { ethers } = require("ethers");
const fs = require('fs');
const readline = require('readline');

class ConfigManager {
  constructor() {
    this.accounts = [];
    this.twitterConfigs = [];
    this.proxies = [];
    this.loadAllConfigs();
  }

  loadAllConfigs() {
    this.loadAccounts();
    this.loadTwitterConfigs();
    this.loadProxies();
  }

  loadAccounts() {
    try {
      if (fs.existsSync('accounts.txt')) {
        const data = fs.readFileSync('accounts.txt', 'utf8');
        const lines = data.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        
        this.accounts = lines.map((line, index) => {
          const parts = line.split('|').map(field => field.trim());
          const [name, wallet, cookie, privateKey, faucetAmount] = parts;
          
          let amount = 2;
          if (faucetAmount && !isNaN(parseInt(faucetAmount))) {
            amount = parseInt(faucetAmount);
          }
          
          // VALIDASI DAN KONVERSI KE CHECKSUM ADDRESS
          let walletChecksum = wallet;
          try {
            walletChecksum = ethers.getAddress(wallet);
          } catch (e) {
            console.log(`âš ï¸ Warning: Invalid address format for ${name}, using as-is`);
          }
          
          return {
            id: index + 1,
            name: name || `Account ${index + 1}`,
            wallet: walletChecksum,
            cookie,
            privateKey: privateKey || '',
            faucetAmount: amount,
            selected: false
          };
        });
        console.log(`âœ… Loaded ${this.accounts.length} accounts from accounts.txt`);
      } else {
        console.log('âŒ accounts.txt file not found');
      }
    } catch (error) {
      console.log('âŒ Failed to load accounts:', error.message);
    }
  }

  loadTwitterConfigs() {
    try {
      if (fs.existsSync('twitter.txt')) {
        const data = fs.readFileSync('twitter.txt', 'utf8');
        const lines = data.split('\n').filter(line => line.trim() && !line.startsWith('#'));
        
        this.twitterConfigs = lines.map((line, index) => {
          const [appKey, appSecret, accessToken, accessSecret, name = `Twitter ${index + 1}`] = line.split('|').map(field => field.trim());
          return {
            id: index + 1,
            name,
            appKey,
            appSecret,
            accessToken,
            accessSecret
          };
        });
        console.log(`âœ… Loaded ${this.twitterConfigs.length} Twitter configs from twitter.txt`);
      } else {
        console.log('âŒ twitter.txt file not found');
      }
    } catch (error) {
      console.log('âŒ Failed to load Twitter configs:', error.message);
    }
  }

  loadProxies() {
    try {
      if (fs.existsSync('proxy.txt')) {
        const data = fs.readFileSync('proxy.txt', 'utf8');
        this.proxies = data.split('\n')
          .filter(line => line.trim() && !line.startsWith('#'))
          .map(proxy => proxy.trim());
        console.log(`âœ… Loaded ${this.proxies.length} proxies from proxy.txt`);
      } else {
        console.log('âŒ proxy.txt file not found');
      }
    } catch (error) {
      console.log('âŒ Failed to load proxies:', error.message);
    }
  }

  getRandomProxy() {
    if (this.proxies.length === 0) return null;
    const randomProxy = this.proxies[Math.floor(Math.random() * this.proxies.length)];
    return new HttpsProxyAgent(randomProxy);
  }

  getTwitterConfig(accountId = 1) {
    const config = this.twitterConfigs[accountId - 1] || this.twitterConfigs[0];
    return config || null;
  }
}

class TwitterHandler {
  constructor(configManager) {
    this.configManager = configManager;
    this.currentTwitterIndex = 0;
  }

  getNextTwitterConfig() {
    if (this.configManager.twitterConfigs.length === 0) {
      return null;
    }
    const config = this.configManager.twitterConfigs[this.currentTwitterIndex];
    this.currentTwitterIndex = (this.currentTwitterIndex + 1) % this.configManager.twitterConfigs.length;
    return config;
  }

  async sendTweet(text, accountId = 1, maxRetries = 3) {
    const config = this.getNextTwitterConfig();
    if (!config) {
      console.log('   âŒ No Twitter configuration available');
      return { success: false, error: 'no_twitter_config' };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`   ðŸ¦ Attempting tweet (attempt ${attempt}/${maxRetries})...`);
        
        const client = new TwitterApi({
          appKey: config.appKey,
          appSecret: config.appSecret,
          accessToken: config.accessToken,
          accessSecret: config.accessSecret,
        });

        const rwClient = client.readWrite;
        const response = await rwClient.v2.tweet(text);
        const tweetId = response?.data?.id;
        
        console.log(`   âœ… Tweet sent via ${config.name}!`);
        console.log(`   ðŸ”— Link: https://x.com/i/web/status/${tweetId}`);
        return { success: true, id: tweetId, text, config: config.name };
        
      } catch (error) {
        const statusCode = error.code || error.response?.status;
        
        if (statusCode === 429 || statusCode === 403) {
          const waitTime = Math.min(attempt * 30000, 300000);
          console.log(`   âš ï¸ Error ${statusCode}, waiting ${waitTime/1000} seconds...`);
          await this.wait(waitTime);
          continue;
        }
        
        console.log(`   âŒ Failed to send tweet (${config.name}): ${error.message}`);
        
        if (attempt < maxRetries) {
          const waitTime = attempt * 15000;
          console.log(`   â³ Waiting ${waitTime/1000} seconds before retrying...`);
          await this.wait(waitTime);
        } else {
          return { success: false, error: error.message };
        }
      }
    }
    
    return { success: false, error: 'max_retries_exceeded' };
  }

  async deleteTweet(tweetId, accountId = 1, maxRetries = 5) {
    const config = this.getNextTwitterConfig();
    if (!config) {
      console.log('   âŒ No Twitter configuration for deletion');
      return { success: false, error: 'no_twitter_config' };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const client = new TwitterApi({
          appKey: config.appKey,
          appSecret: config.appSecret,
          accessToken: config.accessToken,
          accessSecret: config.accessSecret,
        });

        const rwClient = client.readWrite;
        await rwClient.v2.deleteTweet(tweetId);
        console.log(`   ðŸ—‘ï¸ Tweet deleted (ID: ${tweetId}) by ${config.name}`);
        return { success: true };
      } catch (error) {
        const statusCode = error.code || error.response?.status;
        
        if (statusCode === 429 || statusCode === 403) {
          const waitTime = Math.min(attempt * 30000, 300000);
          console.log(`   âš ï¸ Error ${statusCode}, waiting ${waitTime/1000} seconds...`);
          await this.wait(waitTime);
          continue;
        }
        
        console.log(`   âŒ Failed to delete tweet: ${error.message}`);
        
        if (attempt < maxRetries) {
          await this.wait(15000);
        } else {
          return { success: false, error: error.message };
        }
      }
    }
    
    return { success: false, error: 'max_retries_exceeded' };
  }

  createRandomUMITweet() {
    const randomWords = [
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

    const openingSentences = [
      "Hello everyone, have you heard about Umi?",
      "Hey crypto friends, check out Umi!",
      "What's up everyone, Umi is amazing!",
      "Greetings to all Umi enthusiasts!",
      "Hi there, Umi is the future of web3!",
      "Hello community, Umi is revolutionizing crypto!",
      "Hey everyone, Umi is building something special!",
      "What's good everyone, Umi ecosystem is growing!"
    ];

    let tweet = openingSentences[Math.floor(Math.random() * openingSentences.length)];
    
    const additionalWords = Math.max(0, 30 - tweet.split(' ').length);
    
    for (let i = 0; i < additionalWords; i++) {
      tweet += ' ' + randomWords[Math.floor(Math.random() * randomWords.length)];
    }

    if (!tweet.toLowerCase().includes('umi')) {
      tweet += ' Umi';
    }

    return tweet;
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class BridgeHandler {
  constructor() {
    this.RPC = "https://ethereum.uminetwork.com";
    this.CHAIN_ID = 1337;
    this.DESTINATION_ADDRESS = "0xc8088d0362bb4ac757ca77e211c30503d39cef48";
    this.GAS_LIMIT = 976872n;
    this.MAX_FEE_PER_GAS = 3000000010n;
    this.MAX_PRIORITY_FEE_PER_GAS = 3000000000n;
    this.BRIDGE_AMOUNT = ethers.parseEther("1.0");
  }

  async bridgeETH(account, maxRetries = 5) {
    if (!account.privateKey) {
      console.log(`   âš ï¸ [Bridge] No private key for ${account.name}`);
      return { success: false, error: 'no_private_key' };
    }

    for (let currentAttempt = 1; currentAttempt <= maxRetries; currentAttempt++) {
      try {
        console.log(`   ðŸŒ‰ [Bridge] Bridging 1 ETH... (attempt ${currentAttempt}/${maxRetries})`);
        
        const provider = new ethers.JsonRpcProvider(this.RPC, this.CHAIN_ID);
        const wallet = new ethers.Wallet(account.privateKey, provider);

        const balance = await provider.getBalance(wallet.address);
        console.log(`   ðŸ’° Balance: ${ethers.formatEther(balance)} ETH`);

        const maxGasCost = this.GAS_LIMIT * this.MAX_FEE_PER_GAS;
        const minimumBalance = this.BRIDGE_AMOUNT + maxGasCost;

        if (balance < minimumBalance) {
          console.log(`   âŒ [Bridge] Insufficient balance for 1 ETH + gas fee`);
          console.log(`   ðŸ“Š Required: ${ethers.formatEther(minimumBalance)} ETH`);
          console.log(`   ðŸ’µ Available: ${ethers.formatEther(balance)} ETH`);
          return { success: false, error: 'insufficient_balance' };
        }

        const nonce = await provider.getTransactionCount(wallet.address, "pending");
        
        const tx = {
          to: this.DESTINATION_ADDRESS,
          value: this.BRIDGE_AMOUNT,
          gasLimit: this.GAS_LIMIT,
          nonce,
          chainId: this.CHAIN_ID,
          type: 2,
          maxFeePerGas: this.MAX_FEE_PER_GAS,
          maxPriorityFeePerGas: this.MAX_PRIORITY_FEE_PER_GAS,
        };

        console.log(`   ðŸ“¤ Sending 1 ETH bridge transaction...`);
        const sentTx = await wallet.sendTransaction(tx);
        console.log(`   âœ… Bridge TX Sent!`);
        console.log(`   ðŸ”— Hash: ${sentTx.hash}`);

        console.log(`   â³ Waiting for confirmation...`);
        const receipt = await sentTx.wait(1);

        if (receipt.status === 1) {
          const gasUsed = receipt.gasUsed;
          const effectiveGasPrice = receipt.gasPrice || receipt.effectiveGasPrice;
          const gasCost = gasUsed * effectiveGasPrice;

          console.log(`   ðŸŽ‰ðŸŽ‰ 1 ETH BRIDGE SUCCESSFUL! ðŸŽ‰ðŸŽ‰`);
          console.log(`      ðŸ“¦ Block: ${receipt.blockNumber}`);
          console.log(`      â›½ Gas Used: ${gasUsed.toString()}`);
          console.log(`      ðŸ’¸ Gas Cost: ${ethers.formatEther(gasCost)} ETH`);
          console.log(`      ðŸŒ‰ Total Bridged: 1.0 ETH`);
          return { 
            success: true, 
            data: receipt,
            bridgeAmount: this.BRIDGE_AMOUNT,
            gasCost: gasCost
          };
        }

      } catch (error) {
        if (error.code === "INSUFFICIENT_FUNDS") {
          console.log(`   âŒ [Bridge] Insufficient balance for 1 ETH bridge`);
          return { success: false, error: 'insufficient_balance' };
        } else if (error.message.includes("nonce")) {
          console.log(`   âš ï¸ [Bridge] Nonce error, retrying...`);
          if (currentAttempt < maxRetries) {
            await this.wait(5000);
            continue;
          }
        } else {
          console.log(`   âŒ [Bridge] Error: ${error.message}`);
        }
        
        if (currentAttempt < maxRetries) {
          const waitTime = currentAttempt * 10000;
          console.log(`   â³ Waiting ${waitTime/1000} seconds before retrying...`);
          await this.wait(waitTime);
        }
      }
    }
    
    return { success: false, error: 'max_retries_exceeded' };
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class UmiOdysseyBot {
  constructor() {
    this.configManager = new ConfigManager();
    this.accounts = this.configManager.accounts;
    this.selectedAccounts = [];
    this.twitterHandler = new TwitterHandler(this.configManager);
    this.bridgeHandler = new BridgeHandler();
    this.proxyAgent = this.configManager.getRandomProxy();
    this.loopActive = false;
    this.taskStatus = {};
    this.resetDate = this.getTodayDate();
    
    // FIXED ENDPOINTS
    this.faucetUrl = 'https://faucet.uminetwork.com/api/fundUser';
    this.xpUrl = 'https://odyssey.page/api/player/daily-xp';
    this.questFaucetUrl = 'https://odyssey.page/api/quest/check-faucet';
    this.questTweetUrl = 'https://odyssey.page/api/quest/check-tweet';
    
    this.userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
    ];
    
    if (this.accounts.length === 0) {
      console.error('âŒ No accounts found! Please setup accounts.txt file');
      process.exit(1);
    }
  }

  getRandomUserAgent() {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  getOdysseyHeaders(cookie) {
    return {
      'Accept': '*/*',
      'Accept-Encoding': 'gzip, deflate, br, zstd',
      'Accept-Language': 'en-US,en;q=0.6',
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'User-Agent': this.getRandomUserAgent(),
      'Origin': 'https://odyssey.page',
      'Referer': 'https://odyssey.page/quest',
      'sec-ch-ua': '"Chromium";v="142", "Brave";v="142", "Not_A Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
      'Sec-GPC': '1'
    };
  }

  getFaucetHeaders(cookie) {
    return {
      'Accept': '*/*',
      'Content-Type': 'application/json',
      'Cookie': cookie,
      'User-Agent': this.getRandomUserAgent()
    };
  }

  getAxiosInstance() {
    const config = {
      timeout: 60000,
      httpsAgent: this.proxyAgent
    };
    return axios.create(config);
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async waitWithCountdown(ms, message = "Waiting") {
    const totalSeconds = Math.floor(ms / 1000);
    let remainingSeconds = totalSeconds;

    return new Promise((resolve) => {
      const interval = setInterval(() => {
        const hours = Math.floor(remainingSeconds / 3600);
        const minutes = Math.floor((remainingSeconds % 3600) / 60);
        const seconds = remainingSeconds % 60;

        const timeFormat = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        process.stdout.write(`\râ³ ${message}: ${timeFormat} `);

        remainingSeconds--;

        if (remainingSeconds < 0) {
          clearInterval(interval);
          process.stdout.write('\r' + ' '.repeat(100) + '\r');
          resolve();
        }
      }, 1000);
    });
  }

  getCurrentTime() {
    return new Date().toLocaleString('id-ID', { 
      timeZone: 'Asia/Jakarta',
      dateStyle: 'full',
      timeStyle: 'long'
    });
  }

  getTodayDate() {
    return new Date().toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' });
  }

  checkAndResetDailyStatus() {
    const currentDate = this.getTodayDate();
    if (this.resetDate !== currentDate) {
      console.log(`\nðŸ”„ New day detected! Resetting all task status...`);
      console.log(`ðŸ“… Old date: ${this.resetDate}`);
      console.log(`ðŸ“… New date: ${currentDate}`);
      this.taskStatus = {};
      this.resetDate = currentDate;
      console.log(`âœ… Task status reset successfully!\n`);
    }
  }

  initTaskStatus(accountId) {
    if (!this.taskStatus[accountId]) {
      this.taskStatus[accountId] = {
        faucet: false,
        questFaucet: false,
        dailyXP: false,
        questTweet: false,
        bridge: false
      };
    }
  }

  markTaskComplete(accountId, taskName) {
    this.initTaskStatus(accountId);
    this.taskStatus[accountId][taskName] = true;
  }

  checkTaskCompleted(accountId, taskName) {
    this.initTaskStatus(accountId);
    return this.taskStatus[accountId][taskName] === true;
  }

  showTaskStatus(account) {
    this.initTaskStatus(account.id);
    const status = this.taskStatus[account.id];
    console.log(`\n   ðŸ“Š Task Status for ${account.name}:`);
    console.log(`      ${status.faucet ? 'âœ…' : 'â¬œ'} Faucet`);
    console.log(`      ${status.questFaucet ? 'âœ…' : 'â¬œ'} Quest Faucet`);
    console.log(`      ${status.dailyXP ? 'âœ…' : 'â¬œ'} Daily XP & Check-in`);
    console.log(`      ${status.questTweet ? 'âœ…' : 'â¬œ'} Quest Tweet UMI`);
    console.log(`      ${status.bridge ? 'âœ…' : 'â¬œ'} Bridge ETH\n`);
  }

  async selectAccounts() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('\nðŸ“‹ Account List:');
    this.accounts.forEach((account, index) => {
      const bridgeStatus = account.privateKey ? 'ðŸŒ‰' : 'âŒ';
      console.log(`   ${index + 1}. ${account.name} - ${account.wallet.substring(0, 10)}...${account.wallet.slice(-8)} ${bridgeStatus} (Faucet: ${account.faucetAmount} UMI)`);
    });

    const ask = (query) => new Promise(resolve => rl.question(query, resolve));

    try {
      const input = await ask('\nðŸ”¢ Select accounts (numbers separated by comma, or "all" for all): ');
      
      if (input.toLowerCase() === 'all') {
        this.selectedAccounts = [...this.accounts];
        console.log('âœ… Selected all accounts');
      } else {
        const selectedNumbers = input.split(',').map(num => parseInt(num.trim()) - 1);
        this.selectedAccounts = this.accounts.filter((_, index) => selectedNumbers.includes(index));
        
        if (this.selectedAccounts.length === 0) {
          console.log('âš ï¸ No accounts selected, using all accounts');
          this.selectedAccounts = [...this.accounts];
        } else {
          console.log(`âœ… Selected ${this.selectedAccounts.length} accounts`);
        }
      }
      
      this.accounts.forEach(account => {
        account.selected = this.selectedAccounts.some(selected => selected.id === account.id);
      });

    } finally {
      rl.close();
    }
  }

  async claimFaucet(account, maxRetries = 2) {
    if (this.checkTaskCompleted(account.id, 'faucet')) {
      console.log(`   â­ï¸ [1/5] Faucet already claimed today, skipping...`);
      return { success: true, skipped: true };
    }

    const axiosInstance = this.getAxiosInstance();
    
    for (let currentAttempt = 1; currentAttempt <= maxRetries; currentAttempt++) {
      try {
        console.log(`   ðŸ’§ [1/5] Claiming ${account.faucetAmount} UMI... (attempt ${currentAttempt}/${maxRetries})`);
        
        if (currentAttempt > 1) {
          await this.waitWithCountdown(60000, "Delay before faucet retry");
        }
        
        const payload = {
          walletAddress: account.wallet,
          amount: account.faucetAmount
        };

        const response = await axiosInstance.post(this.faucetUrl, payload, {
          headers: this.getFaucetHeaders(account.cookie)
        });

        if (response.status === 200) {
          console.log(`   âœ… [1/5] Successfully claimed ${account.faucetAmount} UMI!`);
          if (response.data) {
            console.log(`   ðŸ“ Data: ${JSON.stringify(response.data)}`);
          }
          this.markTaskComplete(account.id, 'faucet');
          return { success: true, data: response.data };
        }

      } catch (error) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.error || error.message;
        
        console.log(`   âŒ [1/5] Status Code: ${statusCode || 'N/A'}`);
        console.log(`   âŒ [1/5] Error Message: ${errorMessage}`);
        
        if (statusCode === 429) {
          console.log(`   âš ï¸ [1/5] Rate limit! Waiting 2 minutes...`);
          if (currentAttempt < maxRetries) {
            await this.waitWithCountdown(120000, "Waiting for rate limit");
            continue;
          }
        } else if (statusCode === 400) {
          if (errorMessage && errorMessage.toLowerCase().includes('already')) {
            console.log(`   â­ï¸ [1/5] Already claimed today`);
            this.markTaskComplete(account.id, 'faucet');
            return { success: false, error: 'already_claimed' };
          }
          console.log(`   âŒ [1/5] Bad Request: ${errorMessage}`);
          return { success: false, error: errorMessage };
        } else if (statusCode === 401 || statusCode === 403) {
          console.log(`   âŒ [1/5] Invalid or expired cookie!`);
          return { success: false, error: 'invalid_cookie' };
        }
      }
    }

    console.log(`   âŒ [1/5] Failed after ${maxRetries} attempts, moving to next task`);
    return { success: false, error: 'max_retries_exceeded' };
  }

  async claimQuestFaucet(account, maxRetries = 2) {
    if (this.checkTaskCompleted(account.id, 'questFaucet')) {
      console.log(`   â­ï¸ [2/5] Quest Faucet already claimed today, skipping...`);
      return { success: true, skipped: true };
    }

    const axiosInstance = this.getAxiosInstance();

    for (let currentAttempt = 1; currentAttempt <= maxRetries; currentAttempt++) {
      try {
        console.log(`   ðŸŽ¯ [2/5] Claiming Quest Faucet... (attempt ${currentAttempt}/${maxRetries})`);
        
        if (currentAttempt > 1) {
          await this.waitWithCountdown(60000, "Delay before quest faucet retry");
        }
        
        // CORRECT PAYLOAD ACCORDING TO HTTP TOOLKIT
        const payload = {
          questId: 10,
          walletAddress: account.wallet
        };

        console.log(`   ðŸ“¤ Payload: ${JSON.stringify(payload)}`);

        const response = await axiosInstance.post(this.questFaucetUrl, payload, {
          headers: this.getOdysseyHeaders(account.cookie)
        });

        if (response.status === 200) {
          console.log(`   âœ… [2/5] Quest Faucet claimed successfully!`);
          if (response.data) {
            console.log(`   ðŸ“ Response: ${JSON.stringify(response.data)}`);
          }
          this.markTaskComplete(account.id, 'questFaucet');
          return { success: true, data: response.data };
        }

      } catch (error) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.error || error.message;
        
        console.log(`   âŒ [2/5] Status Code: ${statusCode || 'N/A'}`);
        console.log(`   âŒ [2/5] Error Message: ${errorMessage}`);
        
        if (statusCode === 429) {
          console.log(`   âš ï¸ [2/5] Rate limit! Waiting 2 minutes...`);
          if (currentAttempt < maxRetries) {
            await this.waitWithCountdown(120000, "Waiting for rate limit");
            continue;
          }
        } else if (statusCode === 400) {
          if (errorMessage && (errorMessage.toLowerCase().includes('already') || errorMessage.toLowerCase().includes('completed'))) {
            console.log(`   â­ï¸ [2/5] Quest already completed`);
            this.markTaskComplete(account.id, 'questFaucet');
            return { success: false, error: 'quest_completed' };
          }
          console.log(`   âŒ [2/5] Bad Request: ${errorMessage}`);
          return { success: false, error: errorMessage };
        } else if (statusCode === 401 || statusCode === 403) {
          console.log(`   âŒ [2/5] Invalid or expired cookie!`);
          return { success: false, error: 'invalid_cookie' };
        }
      }
    }

    console.log(`   âŒ [2/5] Failed after ${maxRetries} attempts, moving to next task`);
    return { success: false, error: 'max_retries_exceeded' };
  }

  async claimDailyXP(account, maxRetries = 5) {
    if (this.checkTaskCompleted(account.id, 'dailyXP')) {
      console.log(`   â­ï¸ [3/5] Daily XP already claimed today, skipping...`);
      return { success: true, skipped: true };
    }

    const axiosInstance = this.getAxiosInstance();

    for (let currentAttempt = 1; currentAttempt <= maxRetries; currentAttempt++) {
      try {
        console.log(`   â­ [3/5] Claiming Daily XP and Check-in... (attempt ${currentAttempt}/${maxRetries})`);
        
        // CORRECT PAYLOAD ACCORDING TO HTTP TOOLKIT
        // USE CHECKSUM ADDRESS + timeZone (not timezone)
        const payload = {
          walletAddress: account.wallet,
          timeZone: "Asia/Jakarta"
        };

        console.log(`   ðŸ“¤ Payload: ${JSON.stringify(payload)}`);
        console.log(`   ðŸ“ Wallet (Checksum): ${account.wallet}`);
        
        const response = await axiosInstance.post(this.xpUrl, payload, {
          headers: this.getOdysseyHeaders(account.cookie)
        });

        if (response.status === 200) {
          console.log(`   âœ… [3/5] Successfully claimed XP and checked in!`);
          console.log(`   ðŸ“ Response: ${JSON.stringify(response.data)}`);
          
          if (response.data.streakData) {
            console.log(`   ðŸ”¥ Streak: ${response.data.streakData.currentStreak} days`);
            console.log(`   â­ XP Earned: ${response.data.streakData.xpEarned}`);
            console.log(`   ðŸŽ® Level: ${response.data.streakData.newLevel}`);
          }
          
          this.markTaskComplete(account.id, 'dailyXP');
          return { success: true, data: response.data };
        }

      } catch (error) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.error || error.message;
        
        console.log(`   âŒ [3/5] Status Code: ${statusCode || 'N/A'}`);
        console.log(`   âŒ [3/5] Error Message: ${errorMessage}`);
        
        if (errorData) {
          console.log(`   ðŸ“‹ [3/5] Full Error Data: ${JSON.stringify(errorData)}`);
        }
        
        if (statusCode === 429) {
          console.log(`   âš ï¸ [3/5] Rate limit! Waiting 2 minutes...`);
          if (currentAttempt < maxRetries) {
            await this.waitWithCountdown(120000, "Waiting for rate limit");
            continue;
          }
        } else if (statusCode === 400) {
          if (errorMessage && errorMessage.toLowerCase().includes('already')) {
            console.log(`   â­ï¸ [3/5] Already claimed today`);
            this.markTaskComplete(account.id, 'dailyXP');
            return { success: false, error: 'already_claimed' };
          }
          console.log(`   âŒ [3/5] Bad Request - ${errorMessage}`);
        } else if (statusCode === 401 || statusCode === 403) {
          console.log(`   âŒ [3/5] Invalid or expired cookie!`);
          console.log(`   âš ï¸ [3/5] Please update cookie for account: ${account.name}`);
          return { success: false, error: 'invalid_cookie' };
        } else if (statusCode === 404) {
          console.log(`   âŒ [3/5] Endpoint not found - API may have changed`);
          return { success: false, error: 'endpoint_not_found' };
        } else if (statusCode === 500 || statusCode === 502 || statusCode === 503) {
          console.log(`   âš ï¸ [3/5] Server error - trying again`);
          if (currentAttempt < maxRetries) {
            await this.waitWithCountdown(60000, "Waiting for server recovery");
            continue;
          }
        }
        
        if (currentAttempt < maxRetries) {
          const waitTime = currentAttempt * 30000;
          console.log(`   â³ Waiting ${waitTime/1000} seconds before retrying...`);
          await this.wait(waitTime);
        }
      }
    }

    console.log(`   âŒ [3/5] Failed after ${maxRetries} attempts, moving to next task`);
    return { success: false, error: 'max_retries_exceeded' };
  }

  async processUMITweetQuest(account, maxRetries = 3) {
    if (this.checkTaskCompleted(account.id, 'questTweet')) {
      console.log(`   â­ï¸ [4/5] Tweet Quest already claimed today, skipping...`);
      return { success: true, skipped: true };
    }

    const axiosInstance = this.getAxiosInstance();

    console.log(`   ðŸ¦ [4/5] Posting tweet for UMI...`);

    const tweet = this.twitterHandler.createRandomUMITweet();
    console.log(`   ðŸ“ Tweet: "${tweet}"`);
    console.log(`   ðŸ“Š Word count: ${tweet.split(' ').length}`);

    const tweetResult = await this.twitterHandler.sendTweet(tweet, account.id, 2);

    if (!tweetResult.success) {
      console.log(`   âŒ [4/5] Failed to post tweet, skipping this quest`);
      return { success: false, error: 'tweet_failed' };
    }

    console.log(`   â³ Waiting 45 seconds before claiming quest...`);
    await this.waitWithCountdown(45000, "Waiting before claiming tweet quest");

    for (let currentAttempt = 1; currentAttempt <= maxRetries; currentAttempt++) {
      try {
        console.log(`   ðŸŽ¯ [4/5] Claiming UMI tweet quest... (attempt ${currentAttempt}/${maxRetries})`);
        
        if (currentAttempt > 1) {
          await this.waitWithCountdown(30000, "Delay before retry quest UMI");
        }
        
        // CORRECT PAYLOAD ACCORDING TO HTTP TOOLKIT
        const umiPayload = {
          questId: 9,
          walletAddress: account.wallet
        };

        console.log(`   ðŸ“¤ Payload: ${JSON.stringify(umiPayload)}`);

        const umiResponse = await axiosInstance.post(this.questTweetUrl, umiPayload, {
          headers: this.getOdysseyHeaders(account.cookie)
        });

        if (umiResponse.status === 200) {
          console.log(`   âœ… [4/5] UMI Quest claimed successfully!`);
          console.log(`   ðŸ“ Response: ${JSON.stringify(umiResponse.data)}`);
          
          await this.wait(5000);
          console.log(`   ðŸ—‘ï¸ [4/5] Deleting tweet...`);
          await this.twitterHandler.deleteTweet(tweetResult.id, account.id, 2);
          
          this.markTaskComplete(account.id, 'questTweet');
          return { success: true, data: umiResponse.data, tweetId: tweetResult.id };
        }

      } catch (error) {
        const statusCode = error.response?.status;
        const errorData = error.response?.data;
        const errorMessage = errorData?.message || errorData?.error || error.message;
        
        console.log(`   âŒ [4/5] Status Code: ${statusCode || 'N/A'}`);
        console.log(`   âŒ [4/5] Error Message: ${errorMessage}`);
        
        if (statusCode === 429) {
          console.log(`   âš ï¸ [4/5] Rate limit! Waiting 2 minutes...`);
          if (currentAttempt < maxRetries) {
            await this.waitWithCountdown(120000, "Waiting for rate limit");
            continue;
          }
        } else if (statusCode === 400) {
          if (errorMessage && (errorMessage.toLowerCase().includes('already') || errorMessage.toLowerCase().includes('completed'))) {
            console.log(`   â­ï¸ [4/5] UMI Quest already completed`);
            
            await this.wait(3000);
            console.log(`   ðŸ—‘ï¸ [4/5] Deleting tweet...`);
            await this.twitterHandler.deleteTweet(tweetResult.id, account.id, 2);
            
            this.markTaskComplete(account.id, 'questTweet');
            return { success: true, data: { umi: true }, tweetId: tweetResult.id };
          }
          console.log(`   âŒ [4/5] Bad Request: ${errorMessage}`);
        } else if (statusCode === 401 || statusCode === 403) {
          console.log(`   âŒ [4/5] Invalid or expired cookie!`);
          break;
        } else {
          console.log(`   âŒ [4/5] Error: ${error.message}`);
        }
        
        if (currentAttempt < maxRetries) {
          await this.wait(15000);
        }
      }
    }

    console.log(`   ðŸ—‘ï¸ [4/5] Deleting tweet...`);
    await this.twitterHandler.deleteTweet(tweetResult.id, account.id, 2);

    console.log(`   âŒ [4/5] Failed after ${maxRetries} attempts, moving to next task`);
    return { success: false, error: 'quest_failed' };
  }

  async runDailyXPClaimOnly() {
    console.log('\nâ­ === DAILY XP & CHECK-IN ONLY ===\n');
    for (const account of this.selectedAccounts) {
      console.log(`\nðŸ”„ Processing: ${account.name}`);
      console.log(`ðŸ’¼ Wallet: ${account.wallet.substring(0, 10)}...${account.wallet.slice(-8)}`);
      console.log(`ðŸ“ Checksum Address: ${account.wallet}`);
      
      const result = await this.claimDailyXP(account, 5);
      
      if (result.success) {
        console.log(`   âœ… Successfully claimed daily XP for ${account.name}!`);
      } else {
        console.log(`   âŒ Failed to claim daily XP for ${account.name}`);
      }
      
      if (this.selectedAccounts.indexOf(account) < this.selectedAccounts.length - 1) {
        console.log(`\nâ³ 30 second delay before next account...`);
        await this.waitWithCountdown(30000, "Delay between accounts");
      }
    }

    console.log('\nâœ… All accounts completed daily XP claim and check-in!');
  }

  async showMenu() {
    console.log('\n' + '='.repeat(60));
    console.log('ðŸ¤– UMI NETWORK & ODYSSEY AUTOMATION BOT');
    console.log('='.repeat(60));
    console.log('Select feature to run:');
    console.log('1. â­ Daily XP & Check-in Only (FIXED)');
    console.log('2. ðŸ’§ Claim Faucet Only');
    console.log('3. ðŸŒ‰ Bridge 1 ETH Only');
    console.log('4. ðŸŽ¯ Claim Quest Faucet');
    console.log('5. ðŸ¦ Claim Quest Post X (UMI)');
    console.log('6. ðŸš€ Auto Mode (Run All - Once)');
    console.log('7. ðŸ”„ Auto Mode Loop 24 Hours (Continuous)');
    console.log('8. ðŸ”§ Reload Configurations');
    console.log('0. ðŸ‘‹ Exit');
    console.log('='.repeat(60));
  }

  async main() {
    console.log('ðŸ¤– UMI Network & Odyssey Automation Bot');
    console.log('==========================================');
    console.log(`ðŸ“‹ Loaded ${this.accounts.length} accounts`);
    if (this.configManager.twitterConfigs.length > 0) {
      console.log(`ðŸ¦ Loaded ${this.configManager.twitterConfigs.length} Twitter configurations`);
    } else {
      console.log('âŒ No Twitter configurations');
    }

    if (this.configManager.proxies.length > 0) {
      console.log(`ðŸ”’ Loaded ${this.configManager.proxies.length} proxies`);
    } else {
      console.log('âš ï¸ No proxies');
    }

    while (true) {
      await this.showMenu();
      
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const ask = (query) => new Promise(resolve => rl.question(query, resolve));

      try {
        const choice = await ask('\nðŸ”¢ Enter choice (0-8): ');
        
        if (choice !== '8' && choice !== '0') {
          await this.selectAccounts();
        }

        switch (choice) {
          case '1':
            await this.runDailyXPClaimOnly();
            break;
          case '2':
            await this.runFaucetClaimOnly();
            break;
          case '3':
            await this.runBridgeOnly();
            break;
          case '4':
            await this.runQuestFaucetClaim();
            break;
          case '5':
            await this.runQuestTweetClaim();
            break;
          case '6':
            await this.runAutoMode();
            break;
          case '7':
            rl.close();
            await this.runAutoLoopMode();
            return;
          case '8':
            this.configManager.loadAllConfigs();
            this.accounts = this.configManager.accounts;
            console.log('âœ… Configurations reloaded successfully!');
            break;
          case '0':
            console.log('ðŸ‘‹ Goodbye!');
            rl.close();
            return;
          default:
            console.log('âŒ Invalid choice!');
        }

        if (choice !== '7') {
          const continueMenu = await ask('\nðŸ”„ Return to main menu? (y/n): ');
          if (continueMenu.toLowerCase() !== 'y') {
            console.log('ðŸ‘‹ Goodbye!');
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

  async runFaucetClaimOnly() {
    console.log('\nðŸ’§ === FAUCET CLAIM ONLY ===\n');
    for (const account of this.selectedAccounts) {
      console.log(`\nðŸ”„ Processing: ${account.name}`);
      await this.claimFaucet(account);
      await this.wait(30000);
    }
    console.log('\nâœ… All accounts completed faucet claim!');
  }

  async runBridgeOnly() {
    console.log('\nðŸŒ‰ === BRIDGE 1 ETH ONLY ===\n');
    for (const account of this.selectedAccounts) {
      console.log(`\nðŸ”„ Processing: ${account.name}`);
      if (!account.privateKey) {
        console.log(`   âš ï¸ No private key, skipping bridge`);
        continue;
      }
      await this.bridgeHandler.bridgeETH(account);
      await this.wait(30000);
    }
    console.log('\nâœ… All accounts completed bridge!');
  }

  async runQuestFaucetClaim() {
    console.log('\nðŸŽ¯ === QUEST FAUCET CLAIM ===\n');
    for (const account of this.selectedAccounts) {
      console.log(`\nðŸ”„ Processing: ${account.name}`);
      await this.claimQuestFaucet(account);
      await this.wait(30000);
    }
    console.log('\nâœ… All accounts completed quest faucet claim!');
  }

  async runQuestTweetClaim() {
    console.log('\nðŸ¦ === QUEST POST X (UMI) CLAIM ===\n');
    for (const account of this.selectedAccounts) {
      console.log(`\nðŸ”„ Processing: ${account.name}`);
      await this.processUMITweetQuest(account);
      await this.wait(30000);
    }
    console.log('\nâœ… All accounts completed quest tweet claim!');
  }

  async runAutoMode() {
    console.log('\nðŸš€ === AUTO MODE - RUN ALL TASKS ===\n');
    this.checkAndResetDailyStatus();
    for (const account of this.selectedAccounts) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`ðŸ”„ PROCESSING: ${account.name}`);
      console.log(`ðŸ’¼ Wallet: ${account.wallet.substring(0, 10)}...${account.wallet.slice(-8)}`);
      console.log(`${'='.repeat(60)}`);

      await this.claimFaucet(account);
      await this.wait(60000);
      
      await this.claimQuestFaucet(account);
      await this.wait(60000);
      
      await this.claimDailyXP(account);
      await this.wait(60000);
      
      await this.processUMITweetQuest(account);
      await this.wait(60000);

      if (account.privateKey) {
        await this.bridgeHandler.bridgeETH(account);
      }
      
      console.log(`\nâœ… COMPLETED: ${account.name}`);
      
      if (this.selectedAccounts.indexOf(account) < this.selectedAccounts.length - 1) {
        console.log(`\nâ³ 2 minute delay before next account...`);
        await this.waitWithCountdown(120000, "Delay between accounts");
      }
    }

    console.log('\nðŸŽ‰ ALL TASKS COMPLETED!');
  }

  async runAutoLoopMode() {
    console.log('\nðŸ”„ === 24 HOUR AUTO LOOP MODE ===\n');
    this.loopActive = true;
    let round = 1;
    while (this.loopActive) {
      console.log(`\nðŸ”„ ROUND ${round}`);
      console.log(`â° Start Time: ${this.getCurrentTime()}`);
      
      await this.runAutoMode();

      const delayMs = (24 * 60 * 60 * 1000) + (5 * 60 * 1000);
      const nextRun = new Date(Date.now() + delayMs);
      
      console.log(`\nðŸ“… Next round: ${nextRun.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}`);
      await this.waitWithCountdown(delayMs, `Waiting 24 hours 5 minutes for next round`);
      
      round++;
    }
  }
}

async function startBot() {
  try {
    const bot = new UmiOdysseyBot();
    await bot.main();
  } catch (error) {
    console.error('âŒ Failed to run bot:', error);
    process.exit(1);
  }
}

process.on('SIGINT', () => {
  console.log('\n\nðŸ‘‹ Bot stopped by user');
  process.exit(0);
});

startBot();
