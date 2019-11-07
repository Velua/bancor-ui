export interface BareAction {
  name: string;
  data: any;
}

export interface SemiAction extends BareAction {
  account: string;
}

class MultiContractAction {
  contractName?: string;

  constructor(contractName?: string) {
    this.contractName = contractName;
  }

  addAccountProperty(action: BareAction): BareAction | SemiAction {
    return this.contractName
      ? {
          ...action,
          account: this.contractName
        }
      : action;
  }

  delreserve(converter: string, currency: string): BareAction | SemiAction {
    return this.addAccountProperty({
      name: "delreserve",
      data: {
        converter,
        currency
      }
    });
  }

  setreserve(
    converter_currency_code: string,
    currency: string,
    contract: string,
    sale_enabled: boolean,
    ratio: number
  ): BareAction | SemiAction {
    return this.addAccountProperty({
      name: "setreserve",
      data: {
        converter_currency_code,
        currency,
        contract,
        sale_enabled,
        ratio
      }
    });
  }

  updateowner(currency: string, owner: string): BareAction | SemiAction {
    return this.addAccountProperty({
      name: "updateowner",
      data: {
        currency,
        owner
      }
    });
  }

  fund(owner: string, quantity: string): BareAction | SemiAction {
    return this.addAccountProperty({
      name: "fund",
      data: {
        owner,
        quantity
      }
    });
  }

  enablecnvrt(currency: string, enabled: boolean): BareAction | SemiAction {
    return this.addAccountProperty({
      name: "enablecnvrt",
      data: {
        currency,
        enabled
      }
    });
  }

  create(
    owner: string,
    initial_supply: string,
    maximum_supply: string
  ): BareAction | SemiAction {
    return this.addAccountProperty({
      name: "create",
      data: {
        owner,
        initial_supply,
        maximum_supply
      }
    });
  }
}

export const multiContractAction = new MultiContractAction("welovebancor");