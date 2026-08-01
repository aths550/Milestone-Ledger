#![no_std]
//! ReputationRegistry
//!
//! Tracks on-chain reputation for freelancers: number of completed
//! milestones and a running average client rating (1-5).
//!
//! This contract is designed to be called by a `MilestoneEscrow` contract
//! (or any other contract explicitly authorized by the admin) whenever a
//! milestone is approved and paid out. It never handles funds itself.

use soroban_sdk::{contract, contractimpl, contracttype, contracterror, symbol_short, Address, Env, Symbol};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reputation {
    pub completed_milestones: u32,
    pub rating_sum: u32,
    pub rating_count: u32,
}

impl Reputation {
    fn empty() -> Self {
        Reputation {
            completed_milestones: 0,
            rating_sum: 0,
            rating_count: 0,
        }
    }

    /// Average rating scaled to an integer percentage (0-500 => 0.00-5.00)
    pub fn average_rating_x100(&self) -> u32 {
        if self.rating_count == 0 {
            return 0;
        }
        (self.rating_sum * 100) / self.rating_count
    }
}

#[derive(Clone)]
#[contracttype]
enum DataKey {
    Admin,
    Authorized(Address),
    Reputation(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    InvalidRating = 4,
}

const EVT_REP_UPDATED: Symbol = symbol_short!("rep_upd");
const EVT_CALLER_AUTH: Symbol = symbol_short!("caller_ok");

#[contract]
pub struct ReputationRegistry;

#[contractimpl]
impl ReputationRegistry {
    /// Initialize the registry with an admin address. The admin is the only
    /// account allowed to authorize other contracts (e.g. an escrow
    /// contract) to write reputation updates.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Admin-only: allow `caller` (typically a deployed MilestoneEscrow
    /// contract address) to submit reputation updates.
    pub fn authorize_caller(env: Env, caller: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        admin.require_auth();

        env.storage()
            .instance()
            .set(&DataKey::Authorized(caller.clone()), &true);

        env.events().publish((EVT_CALLER_AUTH,), caller);
        Ok(())
    }

    /// Called by an authorized contract when a milestone is approved.
    /// `caller` must be the authorized contract's own address and must
    /// authenticate the call (in practice this is invoked via a
    /// contract-to-contract call where the caller passes its own address).
    pub fn record_completion(
        env: Env,
        caller: Address,
        freelancer: Address,
        rating_1_to_5: u32,
    ) -> Result<Reputation, Error> {
        caller.require_auth();

        if rating_1_to_5 < 1 || rating_1_to_5 > 5 {
            return Err(Error::InvalidRating);
        }

        let is_authorized: bool = env
            .storage()
            .instance()
            .get(&DataKey::Authorized(caller))
            .unwrap_or(false);
        if !is_authorized {
            return Err(Error::NotAuthorized);
        }

        let key = DataKey::Reputation(freelancer.clone());
        let mut rep: Reputation = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(Reputation::empty);

        rep.completed_milestones += 1;
        rep.rating_sum += rating_1_to_5;
        rep.rating_count += 1;

        env.storage().persistent().set(&key, &rep);

        env.events().publish(
            (EVT_REP_UPDATED, freelancer.clone()),
            (rep.completed_milestones, rep.average_rating_x100()),
        );

        Ok(rep)
    }

    pub fn get_reputation(env: Env, freelancer: Address) -> Reputation {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(freelancer))
            .unwrap_or_else(Reputation::empty)
    }
}

mod test;
