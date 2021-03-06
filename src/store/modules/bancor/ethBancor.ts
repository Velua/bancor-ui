import { VuexModule, mutation, action, Module } from "vuex-class-component";
import {
  ProposedTransaction,
  ProposedConvertTransaction,
  LiquidityParams,
  OpposingLiquidParams,
  OpposingLiquid,
  TradingModule,
  LiquidityModule
} from "@/types/bancor";
import { ethBancorApi } from "@/api/bancor";
import {
  getEthRelays,
  web3,
  Relay,
  Token,
  fetchReserveBalance
} from "@/api/helpers";
import { ABISmartToken, ABIConverter, BntTokenContract } from "@/api/ethConfig";
import { toWei, toHex, fromWei } from "web3-utils";
import Decimal from "decimal.js";

import { vxm } from "@/store";

const getPoolReserveToken = (
  relay: Relay,
  networkSymbols = ["BNT", "USDB"]
) => {
  return (
    relay.reserves.find(reserve =>
      networkSymbols.every(networkSymbol => reserve.symbol !== networkSymbol)
    ) || relay.reserves[0]
  );
};

const percentageOfReserve = (
  percent: number,
  existingSupply: string
): string => {
  return new Decimal(percent).times(existingSupply).toFixed(0);
};

const percentageIncrease = (
  deposit: string,
  existingSupply: string
): number => {
  return new Decimal(deposit).div(existingSupply).toNumber();
};

const calculateOppositeFundRequirement = (
  deposit: string,
  depositsSupply: string,
  oppositesSupply: string
): string => {
  const increase = percentageIncrease(deposit, depositsSupply);
  return percentageOfReserve(increase, oppositesSupply);
};

const calculateOppositeLiquidateRequirement = (
  reserveAmount: string,
  reserveBalance: string,
  oppositeReserveBalance: string
) => {
  const increase = percentageIncrease(reserveAmount, reserveBalance);
  return percentageOfReserve(increase, oppositeReserveBalance);
};

const calculateFundReward = (
  reserveAmount: string,
  reserveSupply: string,
  smartSupply: string
) => {
  Decimal.set({ rounding: 0 });
  return new Decimal(reserveAmount)
    .div(reserveSupply)
    .times(smartSupply)
    .times(0.99)
    .toFixed(0);
};

const calculateLiquidateCost = (
  reserveAmount: string,
  reserveBalance: string,
  smartSupply: string
) => {
  const percent = percentageIncrease(reserveAmount, reserveBalance);
  return percentageOfReserve(percent, smartSupply);
};

const percentDifference = (smallAmount: string, bigAmount: string) =>
  new Decimal(smallAmount).div(bigAmount).toNumber();

@Module({ namespacedPath: "ethBancor/" })
export class EthBancorModule extends VuexModule
  implements TradingModule, LiquidityModule {
  tokensList: any[] = [];
  usdPrice: number = 0;
  relaysList: Relay[] = [];
  tokenBalances: { symbol: string; balance: string }[] = [];

  get wallet() {
    return "eth";
  }

  get tokens(): any {
    const ethToken = this.tokensList.find((token: any) => token.code == "ETH")!;
    if (!ethToken) return [];
    // @ts-ignore
    return this.tokensList.map((token: any) => ({
      symbol: token.code,
      name: token.name,
      price: token.price,
      liqDepth: token.liquidityDepth * Number(ethToken.price),
      logo: token.primaryCommunityImageName,
      change24h: token.change24h,
      volume24h: token.volume24h.USD,
      tokenAddress: token.tokenAddress || "",
      balance: token.balance || ""
    }));
  }

  get token(): (arg0: string) => any {
    return (symbolName: string) => {
      const bancorApiToken = this.tokens.find(
        (token: any) => token.symbol == symbolName
      );
      if (bancorApiToken) return bancorApiToken;

      const reserve = this.relaysList
        .find(relay =>
          relay.reserves.some(reserve => reserve.symbol == symbolName)
        )!
        .reserves.find(reserve => reserve.symbol == symbolName)!;

      return {
        ...reserve,
        tokenAddress: reserve.contract,
        logo: `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${reserve.contract}/logo.png`,
        balance:
          (this.tokenBalances.find(balance => balance.symbol == symbolName) &&
            this.tokenBalances.find(balance => balance.symbol == symbolName)!
              .balance) ||
          "0"
      };
    };
  }

  get backgroundToken(): (arg0: string) => any {
    return (symbolName: string) => {
      const res = this.tokensList.find(token => token.code == symbolName);
      if (!res)
        throw new Error(`Failed to find ${symbolName} on this.tokensList`);
      return res;
    };
  }

  // @ts-ignore
  get relay() {
    return (symbolName: string) => {
      const relay = this.relays.find(
        (relay: any) => relay.smartTokenSymbol == symbolName
      );
      if (!relay) throw new Error(`Failed to find relay ${symbolName}`);
      return relay;
    };
  }

  // @ts-ignore
  get relays() {
    const relays = this.relaysList.map(relay => {
      const reserveToken = getPoolReserveToken(relay);
      const reserveTokenMeta = this.token(reserveToken.symbol);
      const networkTokenIsBnt = relay.reserves.some(
        reserve =>
          reserve.contract == "0x1f573d6fb3f13d689ff844b4ce37794d79a7ff1c"
      );
      return {
        reserves: relay.reserves.map(reserve => ({
          symbol: reserve.symbol,
          logo: [
            this.token(reserve.symbol) && this.token(reserve.symbol).logo,
            `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${reserveToken.contract}/logo.png`,
            "https://via.placeholder.com/50"
          ].filter(Boolean)
        })),
        owner: relay.owner,
        fee: relay.fee,
        decimals: reserveToken.decimals,
        symbol: reserveToken.symbol,
        smartTokenSymbol: relay.smartToken.symbol,
        converterAddress: relay.contract,
        smartTokenAddress: relay.smartToken.contract,
        tokenAddress: getPoolReserveToken(relay).contract,
        version: relay.version,
        liqDepth:
          relay.liqDepth ||
          (networkTokenIsBnt && reserveTokenMeta && reserveTokenMeta.liqDepth)
      };
    });
    // .filter(relay => relay.liqDepth);

    const duplicated = relays
      .map(relay => relay.smartTokenSymbol)
      .filter(
        (smartTokenSymbol, index, array) =>
          array.indexOf(smartTokenSymbol) !== index
      );

    return relays.filter(relay =>
      duplicated.every(dup => dup !== relay.smartTokenSymbol)
    );
  }

  @action async fetchUsdPrice() {
    this.setUsdPrice(Number(await ethBancorApi.getRate("BNT", "USD")));
  }

  @mutation setUsdPrice(price: number) {
    this.usdPrice = price;
  }

  @action async triggerTx(actions: any[]) {
    // @ts-ignore
    return this.$store.dispatch("ethWallet/tx", actions, { root: true });
  }

  @action async fetchRelayBalances(smartTokenSymbol: string) {
    const {
      converterAddress,
      tokenAddress,
      smartTokenAddress,
      version
    } = this.relay(smartTokenSymbol)!;

    const converterContract = new web3.eth.Contract(
      // @ts-ignore
      ABIConverter,
      converterAddress
    );

    const smartTokenContract = new web3.eth.Contract(
      // @ts-ignore
      ABISmartToken,
      smartTokenAddress
    );

    const [
      tokenReserveBalance,
      bntReserveBalance,
      totalSupply
    ] = await Promise.all([
      fetchReserveBalance(converterContract, tokenAddress, version),
      fetchReserveBalance(converterContract, BntTokenContract, version),
      smartTokenContract.methods.totalSupply().call()
    ]);
    return { tokenReserveBalance, bntReserveBalance, totalSupply };
  }

  @action async calculateOpposingDeposit(
    opposingDeposit: OpposingLiquidParams
  ): Promise<OpposingLiquid> {
    console.log("calculateOpposingDeposit called", opposingDeposit);
    const { smartTokenSymbol, tokenAmount, tokenSymbol } = opposingDeposit;
    const {
      tokenReserveBalance,
      bntReserveBalance,
      totalSupply
    } = await this.fetchRelayBalances(smartTokenSymbol);
    const tokenId = this.tokensList.find(token => token.code == tokenSymbol).id;
    const decimals = await this.getDecimals(tokenId);
    const tokenAmountWei = String(Number(tokenAmount) * Math.pow(10, decimals));
    const opposingAmount = calculateOppositeFundRequirement(
      tokenAmountWei,
      tokenReserveBalance,
      bntReserveBalance
    );
    const fundReward = calculateFundReward(
      tokenAmountWei,
      tokenReserveBalance,
      totalSupply
    );

    return {
      opposingAmount: fromWei(opposingAmount),
      smartTokenAmount: fundReward
    };
  }

  @action async getUserBalance(tokenContractAddress: string) {
    return vxm.ethWallet.getBalance({
      accountHolder: vxm.wallet.isAuthenticated,
      tokenContractAddress
    });
  }

  @action async getUserBalances(symbolName: string) {
    if (!vxm.wallet.isAuthenticated)
      throw new Error("Cannot find users .isAuthenticated");
    const { smartTokenAddress, tokenAddress } = this.relay(symbolName)!;

    const [
      bntUserBalance,
      tokenUserBalance,
      smartTokenUserBalance
    ] = await Promise.all([
      this.getUserBalance(BntTokenContract),
      this.getUserBalance(tokenAddress),
      this.getUserBalance(smartTokenAddress)
    ]);

    const {
      totalSupply,
      bntReserveBalance,
      tokenReserveBalance
    } = await this.fetchRelayBalances(symbolName);

    const percent = new Decimal(smartTokenUserBalance).div(
      fromWei(totalSupply)
    );
    const token1SmartBalance = percent.times(tokenReserveBalance);
    const token2SmartBalance = percent.times(bntReserveBalance);
    const token1SmartInt = token1SmartBalance.toFixed(0);
    const token2SmartInt = token2SmartBalance.toFixed(0);
    return {
      token1MaxWithdraw: fromWei(token1SmartInt),
      token2MaxWithdraw: fromWei(token2SmartInt),
      token1Balance: tokenUserBalance,
      token2Balance: bntUserBalance,
      smartTokenBalance: smartTokenUserBalance
    };
  }

  @action async calculateOpposingWithdraw(
    opposingWithdraw: OpposingLiquidParams
  ): Promise<OpposingLiquid> {
    const { smartTokenSymbol, tokenAmount, tokenSymbol } = opposingWithdraw;
    const {
      tokenReserveBalance,
      bntReserveBalance,
      totalSupply
    } = await this.fetchRelayBalances(smartTokenSymbol);
    const tokenId = this.tokensList.find(token => token.code == tokenSymbol).id;
    const decimals = await this.getDecimals(tokenId);

    const token1Wei = String(Number(tokenAmount) * Math.pow(10, decimals));
    const token2Value = calculateOppositeLiquidateRequirement(
      token1Wei,
      tokenReserveBalance,
      bntReserveBalance
    );
    const liquidateCost = calculateLiquidateCost(
      token1Wei,
      tokenReserveBalance,
      totalSupply
    );

    const { smartTokenAddress } = this.relay(smartTokenSymbol)!;

    const smartUserBalance = await vxm.ethWallet.getBalance({
      accountHolder: vxm.wallet.isAuthenticated,
      tokenContractAddress: smartTokenAddress
    });

    const percentDifferenceBetweenSmartBalance = percentDifference(
      liquidateCost,
      String(Number(smartUserBalance) * Math.pow(10, 18))
    );
    let smartTokenAmount;
    if (percentDifferenceBetweenSmartBalance > 0.99) {
      const userSmartTokenBalance = toWei(smartUserBalance);
      smartTokenAmount = userSmartTokenBalance;
    } else {
      smartTokenAmount = liquidateCost;
    }
    return {
      opposingAmount: fromWei(token2Value),
      smartTokenAmount
    };
  }

  @action async removeLiquidity({
    fundAmount,
    smartTokenSymbol
  }: LiquidityParams) {
    const { converterAddress } = this.relay(smartTokenSymbol)!;

    const converterContract = new web3.eth.Contract(
      // @ts-ignore
      ABIConverter,
      converterAddress
    );

    const batch = new web3.BatchRequest();

    const liquidateData = converterContract.methods
      .liquidate(fundAmount)
      .encodeABI({ from: vxm.wallet.isAuthenticated });

    const liquidate = {
      from: vxm.wallet.isAuthenticated,
      to: converterAddress,
      value: "0x0",
      data: liquidateData,
      gas: toHex(950000)
    };

    batch.add(
      // @ts-ignore
      web3.eth.sendTransaction.request(liquidate, () => console.log("Pool"))
    );
    console.log(batch, "is batch");
    await batch.execute();
  }

  @action async addLiquidity({
    fundAmount,
    smartTokenSymbol,
    token1Amount,
    token1Symbol,
    token2Amount,
    token2Symbol
  }: LiquidityParams) {
    const { converterAddress, smartTokenAddress, tokenAddress } = this.relay(
      smartTokenSymbol
    )!;

    // const maxGasPrice = await getBancorGasPriceLimit();
    const converterContract = new web3.eth.Contract(
      // @ts-ignore
      ABIConverter,
      converterAddress
    );
    const smartTokenContract = new web3.eth.Contract(
      // @ts-ignore
      ABISmartToken,
      smartTokenAddress
    );

    const tokenContract = new web3.eth.Contract(
      // @ts-ignore
      ABISmartToken,
      tokenAddress
    );

    const bancorTokenContract = new web3.eth.Contract(
      // @ts-ignore
      ABISmartToken,
      BntTokenContract
    );

    const bancorApproved = await bancorTokenContract.methods
      .allowance(vxm.wallet.isAuthenticated, converterAddress)
      .call();

    const tokenApproved = await tokenContract.methods
      .allowance(vxm.wallet.isAuthenticated, converterAddress)
      .call();

    let transactions: any = [
      {
        to: converterAddress,
        data: converterContract.methods.fund(fundAmount),
        gas: toHex(950000)
      }
    ];

    if (Number(fromWei(bancorApproved)) < Number(token2Amount)) {
      transactions = [
        fromWei(bancorApproved) !== "0" && {
          to: BntTokenContract,
          data: bancorTokenContract.methods.approve(
            converterAddress,
            toWei("0")
          ),
          gas: toHex(84999)
        },
        {
          to: BntTokenContract,
          data: bancorTokenContract.methods.approve(
            converterAddress,
            toWei(token2Amount!)
          ),
          gas: toHex(85000)
        },
        ...transactions
      ];
    }

    if (Number(fromWei(tokenApproved)) < Number(token1Amount!)) {
      transactions = [
        fromWei(tokenApproved) !== "0" && {
          to: tokenAddress,
          data: tokenContract.methods.approve(converterAddress, toWei("0")),
          gas: toHex(84999)
        },
        {
          to: tokenAddress,
          data: tokenContract.methods.approve(
            converterAddress,
            toWei(token1Amount!)
          ),
          gas: toHex(85000)
        },
        ...transactions
      ];
    }

    if (tokenAddress == "0xc0829421C1d260BD3cB3E0F06cfE2D52db2cE315") {
      transactions = [
        {
          to: "0xc0829421C1d260BD3cB3E0F06cfE2D52db2cE315",
          value: web3.utils.toHex(toWei(token1Amount!))
        },
        ...transactions
      ];
    }

    const fillOuter = (outer: any) => ({
      from: outer.from || vxm.wallet.isAuthenticated,
      to: outer.to,
      value: outer.value || "0x0",
      ...(outer.data && { data: outer.data }),
      ...(outer.gas && { gas: outer.gas }),
      ...(outer.gasPrice && { gasPrice: outer.gasPrice })
    });

    const batch = new web3.BatchRequest();

    transactions
      .filter(Boolean)
      .map((tx: any) => ({
        ...tx,
        ...(tx.data && {
          data: tx.data.encodeABI({ from: vxm.wallet.isAuthenticated })
        })
      }))
      .forEach((transaction: any, index: number) => {
        batch.add(
          // @ts-ignore
          web3.eth.sendTransaction.request(fillOuter(transaction))
        );
      });

    console.log(batch, "is batch");
    await batch.execute();
  }

  @action async init() {
    const [tokens, relays] = await Promise.all([
      ethBancorApi.getTokens(),
      getEthRelays(),
      this.fetchUsdPrice()
    ]);
    this.setRelaysList(relays);
    const tokensWithAddresses = tokens.map(token => ({
      ...token,
      ...(relays.find((relay: Relay) =>
        relay.reserves.find(reserve => reserve.symbol == token.code)
      ) && {
        tokenAddress: relays
          .find((relay: Relay) =>
            relay.reserves.find(reserve => reserve.symbol == token.code)
          )!
          .reserves.find(reserve => reserve.symbol == token.code)!.contract
      })
    }));

    const relaysNotTrackedOnApi = relays.filter(
      relay =>
        !tokens.find(token => token.code == getPoolReserveToken(relay).symbol)
    );
    this.fetchLiquidityDepths(relaysNotTrackedOnApi);

    this.setTokensList(tokensWithAddresses);
  }

  @action async fetchLiquidityDepths(relays: Relay[]) {
    const relaysCaredAbout = relays.sort((a, b) =>
      a.reserves.some(reserve => reserve.symbol.includes("USD")) ? -1 : 1
    );
    const newRelays: Relay[] = await Promise.all(
      relaysCaredAbout.map(async relay => {
        try {
          const [balance, networkReserveSymbol] = await this.getNetworkReserve(
            relay
          );
          const liqDepthN = networkReserveSymbol == "BNT" ? this.usdPrice : 1;
          const liqDepth = String(
            liqDepthN * Number(web3.utils.fromWei(balance))
          );
          return {
            ...relay,
            liqDepth
          };
        } catch (e) {
          console.log(
            "Failed fetching",
            relay.reserves.map(x => x.symbol),
            e
          );
          return relay;
        }
      })
    );

    const allRelays = [
      ...newRelays.filter(x => x.liqDepth),
      ...this.relaysList
    ].filter(
      (item, index, arr) =>
        arr.findIndex(x => x.smartToken == item.smartToken) == index
    );
    this.setRelaysList(allRelays.filter(Boolean));

    // for (const relay in relaysCaredAbout) {
    //   const x = relaysCaredAbout[relay];
    // const liqDepthN = x.smartToken.symbol == "BNT" ? this.usdPrice : 1;
    // const liqDepth = String(liqDepthN * Number(web3.utils.fromWei(balance)));
    //   const relays = this.relaysList.map(relay =>
    //     relay.smartToken.symbol == x.smartToken.symbol
    //       ? { ...relay, liqDepth }
    //       : relay
    //   );
    //   this.setRelaysList(relays);
    // }
  }

  @action async getNetworkReserve(relay: Relay) {
    const converterContract = new web3.eth.Contract(
      // @ts-ignore
      ABIConverter,
      relay.contract
    );
    const tokenReserve = getPoolReserveToken(relay);
    const networkReserve = relay.reserves.find(
      reserve => reserve.symbol !== tokenReserve.symbol
    )!;

    const reserveBalance = await fetchReserveBalance(
      converterContract,
      networkReserve.contract,
      relay.version
    );
    return [reserveBalance, networkReserve.symbol];
  }

  @action async focusSymbol(symbolName: string) {
    // @ts-ignore
    const isAuthenticated = this.$store.rootGetters[
      "ethWallet/isAuthenticated"
    ];
    if (!isAuthenticated) return;
    const token = this.token(symbolName);
    if (!token.balance) {
      const balance = await vxm.ethWallet.getBalance({
        accountHolder: isAuthenticated,
        tokenContractAddress: token.tokenAddress
      });
      this.updateBalance([symbolName, balance]);
    }
  }

  @mutation updateBalance([symbolName, balance]: [string, string]) {
    this.tokensList = this.tokensList.map(token =>
      token.code == symbolName ? { ...token, balance } : token
    );
    const newBalances = this.tokenBalances.filter(
      balance => balance.symbol !== symbolName
    );
    newBalances.push({ symbol: symbolName, balance });
    this.tokenBalances = newBalances;
  }

  @mutation resetBalances() {
    this.tokensList = this.tokensList.map(token => ({
      ...token,
      balance: undefined
    }));
  }

  @action async refreshBalances(symbols?: string[]) {
    this.resetBalances();
    if (symbols) {
      symbols.forEach(symbol => this.focusSymbol(symbol));
    }
  }

  @mutation setTokensList(tokens: any) {
    this.tokensList = tokens;
  }

  @mutation setRelaysList(relaysList: Relay[]) {
    this.relaysList = relaysList.sort((a, b) =>
      this.tokensList.find(token =>
        a.reserves.find(reserve => reserve.symbol == token.code)
      )
        ? -1
        : 1
    );
  }

  @action async convert({
    fromSymbol,
    toSymbol,
    fromAmount,
    toAmount
  }: ProposedConvertTransaction) {
    const fromObj = this.backgroundToken(fromSymbol);
    const toObj = this.backgroundToken(toSymbol);

    const fromAmountWei = web3.utils.toWei(String(fromAmount));
    const toAmountWei = web3.utils.toWei(String(toAmount));
    const minimumReturnWei = String((Number(toAmountWei) * 0.98).toFixed(0));

    // @ts-ignore
    const ownerAddress = this.$store.rootGetters["ethWallet/isAuthenticated"];
    const convertPost = {
      fromCurrencyId: fromObj.id,
      toCurrencyId: toObj.id,
      amount: fromAmountWei,
      minimumReturn: minimumReturnWei,
      ownerAddress
    };
    const res = await ethBancorApi.convert(convertPost);
    if (res.errorCode) {
      throw new Error(res.errorCode);
    }
    const params = res.data;
    const txRes = await this.triggerTx(params[0]);
    return txRes;
  }

  @action async getReturn({
    fromSymbol,
    toSymbol,
    amount
  }: ProposedTransaction) {
    const fromSymbolApiInstance = this.backgroundToken(fromSymbol);
    const toSymbolApiInstance = this.backgroundToken(toSymbol);
    const [fromTokenDecimals, toTokenDecimals] = await Promise.all([
      this.getDecimals(fromSymbolApiInstance.id),
      this.getDecimals(toSymbolApiInstance.id)
    ]);
    const result = await ethBancorApi.calculateReturn(
      fromSymbolApiInstance.id,
      toSymbolApiInstance.id,
      String(amount * Math.pow(10, fromTokenDecimals))
    );
    return {
      amount: String(Number(result) / Math.pow(10, toTokenDecimals))
    };
  }

  @action async getCost({ fromSymbol, toSymbol, amount }: ProposedTransaction) {
    const fromSymbolApiInstance = this.backgroundToken(fromSymbol);
    const toSymbolApiInstance = this.backgroundToken(toSymbol);
    const [fromTokenDetail, toTokenDetail] = await Promise.all([
      this.getDecimals(fromSymbolApiInstance.id),
      this.getDecimals(toSymbolApiInstance.id)
    ]);
    const result = await ethBancorApi.calculateCost(
      fromSymbolApiInstance.id,
      toSymbolApiInstance.id,
      String(amount * Math.pow(10, toTokenDetail.decimals))
    );
    return {
      amount: String(Number(result) / Math.pow(10, fromTokenDetail.decimals))
    };
  }

  @mutation updateEthToken(token: any) {
    this.tokensList = this.tokensList.map((existingToken: any) =>
      token.id == existingToken.id ? token : existingToken
    );
  }

  @action async getDecimals(symbolId: string) {
    const existingDecimals = this.tokensList.find(
      (token: any) => token.id == symbolId && token.decimals
    );
    if (existingDecimals) {
      return existingDecimals.decimals;
    } else {
      const res = await ethBancorApi.getTokenTicker(symbolId);
      const existingToken = this.tokensList.find(
        (existingToken: any) => existingToken.id == symbolId
      );
      this.updateEthToken({
        ...existingToken,
        decimals: res.decimals
      });
      return res.decimals;
    }
  }
}

export const ethBancor = EthBancorModule.ExtractVuexModule(EthBancorModule);
