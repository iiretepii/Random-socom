package tekeco.wallet;

/** Emeralds held by one villager, plus when they were last paid. */
public interface IWallet {
    /** Day number for a villager the payroll hasn't seen yet. */
    long NEVER = -1L;

    int getCoins();

    void setCoins(int coins);

    void add(int amount);

    /** Removes {@code amount} if the wallet holds that much; otherwise leaves it unchanged. */
    boolean take(int amount);

    long getLastPaidDay();

    void setLastPaidDay(long day);

    int getLastWage();

    void setLastWage(int wage);

    default boolean isNew() {
        return getLastPaidDay() == NEVER;
    }

    default void copyFrom(IWallet other) {
        setCoins(other.getCoins());
        setLastPaidDay(other.getLastPaidDay());
        setLastWage(other.getLastWage());
    }
}
