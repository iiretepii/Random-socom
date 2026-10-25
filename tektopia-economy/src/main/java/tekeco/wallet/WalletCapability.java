package tekeco.wallet;

import javax.annotation.Nullable;
import net.minecraft.entity.Entity;
import net.minecraft.nbt.NBTBase;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraft.util.EnumFacing;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.common.capabilities.Capability;
import net.minecraftforge.common.capabilities.CapabilityInject;
import net.minecraftforge.common.capabilities.CapabilityManager;
import net.minecraftforge.common.capabilities.ICapabilitySerializable;
import tekeco.TekEconomy;

/** Registers the wallet capability and attaches it to TekTopia villagers (see EconomyEvents). */
public final class WalletCapability {
    @CapabilityInject(IWallet.class)
    public static Capability<IWallet> WALLET = null;

    public static final ResourceLocation KEY = new ResourceLocation(TekEconomy.MODID, "wallet");

    private WalletCapability() {
    }

    public static void register() {
        CapabilityManager.INSTANCE.register(IWallet.class, new Storage(), Wallet::new);
    }

    @Nullable
    public static IWallet get(Entity entity) {
        return WALLET != null && entity.hasCapability(WALLET, null) ? entity.getCapability(WALLET, null) : null;
    }

    public static class Storage implements Capability.IStorage<IWallet> {
        @Override
        public NBTBase writeNBT(Capability<IWallet> capability, IWallet wallet, EnumFacing side) {
            NBTTagCompound tag = new NBTTagCompound();
            tag.setInteger("coins", wallet.getCoins());
            tag.setLong("lastPaidDay", wallet.getLastPaidDay());
            tag.setInteger("lastWage", wallet.getLastWage());
            return tag;
        }

        @Override
        public void readNBT(Capability<IWallet> capability, IWallet wallet, EnumFacing side, NBTBase nbt) {
            if (nbt instanceof NBTTagCompound) {
                NBTTagCompound tag = (NBTTagCompound) nbt;
                wallet.setCoins(tag.getInteger("coins"));
                wallet.setLastPaidDay(tag.hasKey("lastPaidDay") ? tag.getLong("lastPaidDay") : IWallet.NEVER);
                wallet.setLastWage(tag.getInteger("lastWage"));
            }
        }
    }

    public static class Provider implements ICapabilitySerializable<NBTTagCompound> {
        private final IWallet wallet = new Wallet();

        @Override
        public boolean hasCapability(Capability<?> capability, @Nullable EnumFacing facing) {
            return capability == WALLET;
        }

        @Nullable
        @Override
        public <T> T getCapability(Capability<T> capability, @Nullable EnumFacing facing) {
            return capability == WALLET ? WALLET.cast(wallet) : null;
        }

        @Override
        public NBTTagCompound serializeNBT() {
            return (NBTTagCompound) WALLET.getStorage().writeNBT(WALLET, wallet, null);
        }

        @Override
        public void deserializeNBT(NBTTagCompound nbt) {
            WALLET.getStorage().readNBT(WALLET, wallet, null, nbt);
        }
    }
}
