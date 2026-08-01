#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token::StellarAssetClient, Env};

fn setup() -> (
    Env,
    MilestoneEscrowClient<'static>,
    reputation_registry::ReputationRegistryClient<'static>,
    Address, // client
    Address, // freelancer
    Address, // token contract address
) {
    let env = Env::default();
    env.mock_all_auths();

    let client_addr = Address::generate(&env);
    let freelancer_addr = Address::generate(&env);
    let token_admin = Address::generate(&env);

    // Set up a Stellar Asset Contract to use as the payment token in tests.
    let token_contract_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token_admin_client = StellarAssetClient::new(&env, &token_contract_id.address());
    token_admin_client.mint(&client_addr, &10_000_000);

    // Set up the ReputationRegistry contract.
    let rep_contract_id = env.register_contract(None, reputation_registry::ReputationRegistry);
    let rep_client = reputation_registry::ReputationRegistryClient::new(&env, &rep_contract_id);
    rep_client.initialize(&token_admin); // any admin works for this test

    // Set up the MilestoneEscrow contract.
    let escrow_contract_id = env.register_contract(None, MilestoneEscrow);
    let escrow_client = MilestoneEscrowClient::new(&env, &escrow_contract_id);

    // Authorize the escrow contract to write reputation updates.
    rep_client.authorize_caller(&escrow_contract_id);

    let milestones = soroban_sdk::vec![
        &env,
        (Symbol::new(&env, "design_mockups"), 1_000_000i128),
        (Symbol::new(&env, "final_delivery"), 2_000_000i128),
    ];

    escrow_client.initialize(
        &client_addr,
        &freelancer_addr,
        &token_contract_id.address(),
        &rep_contract_id,
        &milestones,
    );

    (
        env,
        escrow_client,
        rep_client,
        client_addr,
        freelancer_addr,
        token_contract_id.address(),
    )
}

#[test]
fn test_full_milestone_lifecycle_pays_and_updates_reputation() {
    let (env, escrow, rep, _client, freelancer, token_addr) = setup();

    escrow.fund_milestone(&0);
    let m0 = escrow.get_milestone(&0);
    assert_eq!(m0.status, MilestoneStatus::Funded);

    escrow.submit_milestone(&0);
    let m0 = escrow.get_milestone(&0);
    assert_eq!(m0.status, MilestoneStatus::Submitted);

    escrow.approve_milestone(&0, &5);
    let m0 = escrow.get_milestone(&0);
    assert_eq!(m0.status, MilestoneStatus::Approved);

    // Freelancer got paid the milestone amount.
    let token_client = token::Client::new(&env, &token_addr);
    assert_eq!(token_client.balance(&freelancer), 1_000_000);

    // Reputation was updated via the cross-contract call triggered inside
    // approve_milestone -- this is the inter-contract communication check.
    let rep_data = rep.get_reputation(&freelancer);
    assert_eq!(rep_data.completed_milestones, 1);
    assert_eq!(rep_data.average_rating_x100(), 500);
}

#[test]
fn test_cannot_approve_before_submission() {
    let (_env, escrow, _rep, _client, _freelancer, _token_addr) = setup();
    escrow.fund_milestone(&0);
    let result = escrow.try_approve_milestone(&0, &5);
    assert!(result.is_err());
}

#[test]
fn test_second_milestone_accumulates_reputation() {
    let (_env, escrow, rep, _client, freelancer, _token_addr) = setup();

    escrow.fund_milestone(&0);
    escrow.submit_milestone(&0);
    escrow.approve_milestone(&0, &4);

    escrow.fund_milestone(&1);
    escrow.submit_milestone(&1);
    escrow.approve_milestone(&1, &5);

    let rep_data = rep.get_reputation(&freelancer);
    assert_eq!(rep_data.completed_milestones, 2);
    assert_eq!(rep_data.average_rating_x100(), 450); // (4+5)/2 = 4.5 -> 450
}

#[test]
fn test_invalid_rating_rejected() {
    let (_env, escrow, _rep, _client, _freelancer, _token_addr) = setup();
    escrow.fund_milestone(&0);
    escrow.submit_milestone(&0);
    let result = escrow.try_approve_milestone(&0, &0);
    assert!(result.is_err());
}

#[test]
fn test_invalid_index_rejected() {
    let (_env, escrow, _rep, _client, _freelancer, _token_addr) = setup();
    let result = escrow.try_fund_milestone(&99);
    assert!(result.is_err());
}

#[test]
fn test_add_milestone_post_initialization() {
    let (env, escrow, _rep, _client, _freelancer, _token_addr) = setup();
    let initial_count = escrow.get_milestones().len();
    assert_eq!(initial_count, 2);

    let new_idx = escrow.add_milestone(&Symbol::new(&env, "bug_fixes"), &1_500_000i128);
    assert_eq!(new_idx, 2);

    let m2 = escrow.get_milestone(&2);
    assert_eq!(m2.description, Symbol::new(&env, "bug_fixes"));
    assert_eq!(m2.amount, 1_500_000);
    assert_eq!(m2.status, MilestoneStatus::Created);

    assert_eq!(escrow.get_milestones().len(), 3);
}
