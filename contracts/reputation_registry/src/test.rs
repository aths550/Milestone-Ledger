#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::Env;

fn setup() -> (Env, ReputationRegistryClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, ReputationRegistry);
    let client = ReputationRegistryClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    (env, client, admin)
}

#[test]
fn test_initialize_sets_admin_once() {
    let (env, client, _admin) = setup();
    let another_admin = Address::generate(&env);
    let result = client.try_initialize(&another_admin);
    assert!(result.is_err());
}

#[test]
fn test_authorize_and_record_completion() {
    let (env, client, _admin) = setup();
    let escrow_contract = Address::generate(&env);
    let freelancer = Address::generate(&env);

    client.authorize_caller(&escrow_contract);

    let rep = client.record_completion(&escrow_contract, &freelancer, &5);
    assert_eq!(rep.completed_milestones, 1);
    assert_eq!(rep.rating_count, 1);
    assert_eq!(rep.average_rating_x100(), 500);

    let rep2 = client.record_completion(&escrow_contract, &freelancer, &3);
    assert_eq!(rep2.completed_milestones, 2);
    assert_eq!(rep2.rating_count, 2);
    assert_eq!(rep2.average_rating_x100(), 400); // (5+3)/2 = 4.00

    let fetched = client.get_reputation(&freelancer);
    assert_eq!(fetched, rep2);
}

#[test]
fn test_unauthorized_caller_rejected() {
    let (env, client, _admin) = setup();
    let random_contract = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let result = client.try_record_completion(&random_contract, &freelancer, &4);
    assert_eq!(result, Err(Ok(Error::NotAuthorized)));
}

#[test]
fn test_invalid_rating_rejected() {
    let (env, client, _admin) = setup();
    let escrow_contract = Address::generate(&env);
    let freelancer = Address::generate(&env);
    client.authorize_caller(&escrow_contract);

    let result = client.try_record_completion(&escrow_contract, &freelancer, &0);
    assert_eq!(result, Err(Ok(Error::InvalidRating)));

    let result2 = client.try_record_completion(&escrow_contract, &freelancer, &6);
    assert_eq!(result2, Err(Ok(Error::InvalidRating)));
}

#[test]
fn test_default_reputation_for_unknown_freelancer() {
    let (env, client, _admin) = setup();
    let freelancer = Address::generate(&env);
    let rep = client.get_reputation(&freelancer);
    assert_eq!(rep.completed_milestones, 0);
    assert_eq!(rep.average_rating_x100(), 0);
}
