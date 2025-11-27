mod test;
use dep::aztec::macros::aztec;

#[aztec]
pub contract PrivateVoting {
    // docs:start:imports
    use dep::aztec::macros::{functions::{external, initializer, only_self}, storage::storage};
    use dep::aztec::protocol_types::{address::AztecAddress, traits::Serialize};
    use dep::aztec::state_vars::{
        Map, one_time_action::OneTimeAction, PublicImmutable, PublicMutable,
    };

    #[derive(Serialize)]
    struct Vote {}

    // docs:end:imports
    // docs:start:storage_struct
    #[storage]
    struct Storage<Context> {
        admin: PublicMutable<AztecAddress, Context>, // admin can end vote
        tally: Map<Field, PublicMutable<Field, Context>, Context>, // we will store candidate as key and number of votes as value
        vote_ended: PublicMutable<bool, Context>, // vote_ended is boolean
        active_at_block: PublicImmutable<u32, Context>, // when people can start voting
        vote_coupons: OneTimeAction<Vote, Context>, // ensure that each user can only vote once
    }
    // docs:end:storage_struct

    // docs:start:constructor
    #[external("public")]
    #[initializer]
    fn constructor(admin: AztecAddress) {
        self.storage.admin.write(admin);
        self.storage.vote_ended.write(false);
        self.storage.active_at_block.initialize(self.context.block_number());
    }
    // docs:end:constructor

    #[external("private")]
    fn cast_vote(candidate: Field) {
        self.storage.vote_coupons.at(self.msg_sender().unwrap()).do(Vote {});
        self.enqueue_self.add_to_tally_public(candidate);
    }

    #[external("public")]
    #[only_self]
    fn add_to_tally_public(candidate: Field) {
        assert(self.storage.vote_ended.read() == false, "Vote has ended"); // assert that vote has not ended
        let new_tally = self.storage.tally.at(candidate).read() + 1;
        self.storage.tally.at(candidate).write(new_tally);
    }

    #[external("public")]
    fn end_vote() {
        assert(
            self.storage.admin.read().eq(self.msg_sender().unwrap()),
            "Only admin can end votes",
        ); // assert that caller is admin
        self.storage.vote_ended.write(true);
    }
    #[external("utility")]
    unconstrained fn get_vote(candidate: Field) -> Field {
        self.storage.tally.at(candidate).read()
    }
}
