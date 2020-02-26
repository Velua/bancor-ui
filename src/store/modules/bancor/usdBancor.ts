import { VuexModule, action, Module, mutation } from "vuex-class-component";

import {
  ProposedTransaction,
  ProposedConvertTransaction,
  TradingModule,
  ViewToken,
  ModulePool,
  ModulePools
} from "@/types/bancor";
import { vxm } from "@/store";
import {
  get_pools,
  get_price,
  get_settings,
  Pools,
  get_fee,
  get_weekly_volume,
  Pool
} from "sx";
import { rpc } from "@/api/rpc";
import { split, Asset, Symbol, double_to_asset } from "eos-common";

@Module({ namespacedPath: "usdsBancor/" })
export class UsdBancorModule extends VuexModule implements TradingModule {
  tokensList: ModulePools | undefined = undefined;
  initiated: boolean = false;

  get wallet() {
    return "eos";
  }

  get tokens(): ViewToken[] {
    if (!this.initiated) {
      return [];
    }
    const tokens = Object.keys(this.tokensList!);
    return tokens.map(token => {
      let name, logo, balance;

      try {
        const eosModuleBorrowed = vxm.eosBancor.token(token);
        name = eosModuleBorrowed.name;
        logo = eosModuleBorrowed.logo;
        balance = eosModuleBorrowed.balance || "0";
      } catch (e) {
        name = token;
        logo =
          "https://storage.googleapis.com/bancor-prod-file-store/images/communities/f39c32b0-cfae-11e9-9f7d-af4705d95e66.jpeg";
        balance = "0";
      }
      return {
        symbol: token,
        name,
        price: this.tokensList![token].pegged.to_double(),
        liqDepth:
          this.tokensList![token].depth.to_double() *
          this.tokensList![token].pegged.to_double(),
        logo,
        change24h: 0,
        volume24h: this.tokensList![token].volume24h,
        balance
      };
    });
  }

  get token() {
    return (arg0: string) => {
      const token = this.tokens.find(token => token.symbol == arg0);
      if (!token) throw new Error("Cannot find token");
      return token;
    };
  }

  @mutation setTokensList(pools: ModulePools) {
    this.tokensList = pools;
  }

  @mutation moduleInitiated() {
    this.initiated = true;
  }

  @action async init() {
    const [pools, volume] = await Promise.all([
      // @ts-ignore
      get_pools(rpc),
      // @ts-ignore
      get_weekly_volume(rpc, 1)
    ]);
    for (const pool in pools) {
      pools[pool] = {
        ...pools[pool],
        volume24h: pools[pool].pegged.to_double() * volume[0]["volume"][pool]
      };
    }
    this.setTokensList(pools);
    this.moduleInitiated();
  }

  @action async focusSymbol(symbolName: string) {}
  @action async refreshBalances(symbols: string[] = []) {}

  @action async convert(propose: ProposedConvertTransaction) {
    console.log(propose, "one of the cases");
    console.log(this.tokensList);

    // @ts-ignore
    const accountName = this.$store.rootState.eosWallet.walletState.auth
      .accountName;

    const fromToken = this.tokensList![propose.fromSymbol];

    const tokenContract = fromToken.id.contract;
    const precision = fromToken.id.sym.precision();
    const amountAsset = double_to_asset(
      propose.fromAmount,
      new Symbol(propose.fromSymbol, precision)
    );

    const txRes = await this.triggerTx([
      {
        account: tokenContract,
        name: "transfer",
        data: {
          from: accountName,
          // @ts-ignore
          to: process.env.VUE_APP_USDSTABLE!,
          memo: propose.toSymbol,
          quantity: amountAsset.to_string()
        }
      }
    ]);

    return txRes.transaction_id;
  }

  @action async triggerTx(actions: any[]) {
    // @ts-ignore
    return this.$store.dispatch("eosWallet/tx", actions, { root: true });
  }

  @action async getReturn(propose: ProposedTransaction) {
    const { fromSymbol, amount, toSymbol } = propose;
    // @ts-ignore
    const pools = await get_pools(rpc);
    // @ts-ignore
    const settings = await get_settings(rpc);

    const fromPrecision = pools[fromSymbol].balance.symbol.precision();
    const toPrecision = pools[toSymbol].balance.symbol.precision();

    // @ts-ignore
    const result = get_price(
      // @ts-ignore
      double_to_asset(amount, new Symbol(fromSymbol, fromPrecision)),
      new Symbol(toSymbol, toPrecision).code(),
      pools
    );

    const fee = get_fee(result, settings);

    return {
      amount: String(result.to_double() - fee.to_double())
    };
  }

  @action async getCost(propose: ProposedTransaction) {
    return {
      amount: String(propose.amount * 3)
    };
  }
}

export const usdsBancor = UsdBancorModule.ExtractVuexModule(UsdBancorModule);
