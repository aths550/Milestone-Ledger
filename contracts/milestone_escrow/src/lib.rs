#![no_std]
//! MilestoneEscrow
//!
//! A client funds a project with the freelancer broken into discrete
//! milestones. The freelancer submits work per milestone; the client
//! approves it, which triggers:
//!   1. Token payout from escrow to the freelancer (SEP-41 token transfer)
//!   2. A cross-contract call into `ReputationRegistry.record_completion`
//!      so the freelancer's on-chain reputation updates atomically with
//!      payment.
//!
//! This is the project's inter-contract-communication centerpiece: step 2
//! only happens if step 1 succeeds, and both happen in a single
//! transaction from the client's perspective.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, vec, Address, Env,
    IntoVal, Symbol, Val, Vec,
};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MilestoneStatus {
    Created,
    Funded,
    Submitted,
    Approved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub description: Symbol,
    pub amount: i128,
    pub status: MilestoneStatus,
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Client,
    Freelancer,
    Token,
    ReputationContract,
    Milestones,
    Initialized,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidIndex = 3,
    WrongStatus = 4,
    InvalidRating = 5,
}

const EVT_FUNDED: Symbol = symbol_short!("funded");
const EVT_SUBMITTED: Symbol = symbol_short!("submitted");
const EVT_APPROVED: Symbol = symbol_short!("approved");
const EVT_PAID: Symbol = symbol_short!("paid");
const EVT_ADDED: Symbol = symbol_short!("added");

#[contract]
pub struct MilestoneEscrow;

#[contractimpl]
impl MilestoneEscrow {
    /// Set up the escrow. `milestones` is a list of (description, amount)
    /// pairs defining the project's payment schedule. Funds are *not*
    /// pulled from the client here -- each milestone must be funded
    /// individually via `fund_milestone`, so the client can drip-feed
    /// capital as the project progresses.
    pub fn initialize(
        env: Env,
        client: Address,
        freelancer: Address,
        token: Address,
        reputation_contract: Address,
        milestones: Vec<(Symbol, i128)>,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(Error::AlreadyInitialized);
        }
        client.require_auth();

        let mut stored: Vec<Milestone> = Vec::new(&env);
        for (description, amount) in milestones.iter() {
            stored.push_back(Milestone {
                description,
                amount,
                status: MilestoneStatus::Created,
            });
        }

        env.storage().instance().set(&DataKey::Client, &client);
        env.storage()
            .instance()
            .set(&DataKey::Freelancer, &freelancer);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::ReputationContract, &reputation_contract);
        env.storage().instance().set(&DataKey::Milestones, &stored);
        env.storage().instance().set(&DataKey::Initialized, &true);

        Ok(())
    }

    /// Client deposits the milestone's payment amount into escrow.
    pub fn fund_milestone(env: Env, index: u32) -> Result<(), Error> {
        let client: Address = Self::get_client(&env)?;
        client.require_auth();

        let mut milestones = Self::get_milestones_internal(&env)?;
        let mut milestone = milestones
            .get(index)
            .ok_or(Error::InvalidIndex)?;

        if milestone.status != MilestoneStatus::Created {
            return Err(Error::WrongStatus);
        }

        let token_id: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_id);
        token_client.transfer(&client, &env.current_contract_address(), &milestone.amount);

        milestone.status = MilestoneStatus::Funded;
        milestones.set(index, milestone.clone());
        env.storage()
            .instance()
            .set(&DataKey::Milestones, &milestones);

        env.events()
            .publish((EVT_FUNDED, index), milestone.amount);
        Ok(())
    }

    /// Freelancer marks a funded milestone as submitted for review.
    pub fn submit_milestone(env: Env, index: u32) -> Result<(), Error> {
        let freelancer: Address = env.storage().instance().get(&DataKey::Freelancer).unwrap();
        freelancer.require_auth();

        let mut milestones = Self::get_milestones_internal(&env)?;
        let mut milestone = milestones.get(index).ok_or(Error::InvalidIndex)?;

        if milestone.status != MilestoneStatus::Funded {
            return Err(Error::WrongStatus);
        }
        milestone.status = MilestoneStatus::Submitted;
        milestones.set(index, milestone);
        env.storage()
            .instance()
            .set(&DataKey::Milestones, &milestones);

        env.events().publish((EVT_SUBMITTED, index), ());
        Ok(())
    }

    /// Client approves a submitted milestone: pays the freelancer and
    /// records reputation via a cross-contract call. `rating_1_to_5` is the
    /// client's rating of this specific milestone's work.
    pub fn approve_milestone(env: Env, index: u32, rating_1_to_5: u32) -> Result<(), Error> {
        let client: Address = Self::get_client(&env)?;
        client.require_auth();

        if rating_1_to_5 < 1 || rating_1_to_5 > 5 {
            return Err(Error::InvalidRating);
        }

        let mut milestones = Self::get_milestones_internal(&env)?;
        let mut milestone = milestones.get(index).ok_or(Error::InvalidIndex)?;

        if milestone.status != MilestoneStatus::Submitted {
            return Err(Error::WrongStatus);
        }

        // 1. Pay the freelancer from escrow.
        let token_id: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let freelancer: Address = env.storage().instance().get(&DataKey::Freelancer).unwrap();
        let token_client = token::Client::new(&env, &token_id);
        token_client.transfer(
            &env.current_contract_address(),
            &freelancer,
            &milestone.amount,
        );

        milestone.status = MilestoneStatus::Approved;
        milestones.set(index, milestone.clone());
        env.storage()
            .instance()
            .set(&DataKey::Milestones, &milestones);

        env.events().publish((EVT_APPROVED, index), rating_1_to_5);
        env.events()
            .publish((EVT_PAID, index), (freelancer.clone(), milestone.amount));

        // 2. Cross-contract call: update the freelancer's reputation.
        //    This is invoked dynamically (by Address + function name)
        //    rather than through a generated client, so this crate has no
        //    hard compile-time dependency on reputation_registry's wasm.
        let reputation_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::ReputationContract)
            .unwrap();

        let this_contract = env.current_contract_address();
        let args: Vec<Val> = vec![
            &env,
            this_contract.into_val(&env),
            freelancer.into_val(&env),
            rating_1_to_5.into_val(&env),
        ];
        let _: Val = env.invoke_contract(
            &reputation_contract,
            &Symbol::new(&env, "record_completion"),
            args,
        );

        Ok(())
    }

    /// Client adds a new milestone to the escrow post-initialization.
    pub fn add_milestone(env: Env, description: Symbol, amount: i128) -> Result<u32, Error> {
        let client: Address = Self::get_client(&env)?;
        client.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidRating);
        }

        let mut milestones = Self::get_milestones_internal(&env)?;
        milestones.push_back(Milestone {
            description,
            amount,
            status: MilestoneStatus::Created,
        });
        let new_index = milestones.len() - 1;

        env.storage()
            .instance()
            .set(&DataKey::Milestones, &milestones);

        env.events().publish((EVT_ADDED, new_index), amount);

        Ok(new_index)
    }

    pub fn get_milestone(env: Env, index: u32) -> Result<Milestone, Error> {
        let milestones = Self::get_milestones_internal(&env)?;
        milestones.get(index).ok_or(Error::InvalidIndex)
    }

    pub fn get_milestones(env: Env) -> Result<Vec<Milestone>, Error> {
        Self::get_milestones_internal(&env)
    }

    pub fn get_client(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Client)
            .ok_or(Error::NotInitialized)
    }

    fn get_milestones_internal(env: &Env) -> Result<Vec<Milestone>, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Milestones)
            .ok_or(Error::NotInitialized)
    }
}

mod test;
